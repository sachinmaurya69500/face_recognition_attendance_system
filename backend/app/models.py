"""Face detection and embedding model service.

This module owns InsightFace model loading and serialized GPU/CPU inference. API
routes should use FaceModel.detect() instead of accessing model internals.
"""

import asyncio
import os

import cv2
from insightface.app import FaceAnalysis
import onnxruntime as ort


class FaceModel:
    def __init__(self):
        self.name = os.getenv("INSIGHTFACE_MODEL", "buffalo_l")
        self.root = os.getenv("INSIGHTFACE_ROOT", "/workspace")
        self.max_faces = int(os.getenv("MAX_FACES", "500"))
        self.det_threshold = float(os.getenv("FACE_DET_THRESHOLD", "0.35"))
        self.require_gpu = os.getenv("REQUIRE_GPU", "0").lower() in {"1", "true", "yes"}
        requested = [item.strip() for item in os.getenv("INFERENCE_PROVIDERS", "CUDAExecutionProvider,CPUExecutionProvider").split(",") if item.strip()]
        available = ort.get_available_providers()
        self._provider_candidates = [item for item in requested if item in available]
        if "CPUExecutionProvider" in available and "CPUExecutionProvider" not in self._provider_candidates:
            self._provider_candidates.append("CPUExecutionProvider")
        self.providers = []
        self.app = None
        self._lock = asyncio.Semaphore(1)

    def load(self):
        if not self._provider_candidates:
            raise RuntimeError(f"No configured ONNX Runtime providers are available. Available: {ort.get_available_providers()}")
        if self.require_gpu and "CUDAExecutionProvider" not in self._provider_candidates:
            raise RuntimeError(
                "GPU is required, but CUDAExecutionProvider is unavailable. "
                f"Available providers: {ort.get_available_providers()}"
            )

        # CUDA can be listed by ONNX Runtime while still being unusable (for
        # example, when the host driver or CUDA libraries are unavailable).
        # Retry with CPU so the same image remains usable on a CPU-only host.
        attempts = [self._provider_candidates]
        if "CPUExecutionProvider" in self._provider_candidates:
            attempts.append(["CPUExecutionProvider"])
        errors = []
        for providers in attempts:
            try:
                model = FaceAnalysis(name=self.name, root=self.root, providers=providers)
                model.prepare(ctx_id=0, det_size=(1600, 1600))
                model.det_model.det_thresh = self.det_threshold
                active_providers = set()
                for face_model in model.models.values():
                    active_providers.update(face_model.session.get_providers())
                if self.require_gpu and "CUDAExecutionProvider" not in active_providers:
                    raise RuntimeError(
                        "CUDAExecutionProvider was requested but no model session is using it. "
                        f"Active providers: {sorted(active_providers)}"
                    )
                self.app = model
                self.providers = [provider for provider in providers if provider in active_providers]
                return
            except Exception as exc:
                errors.append(f"{providers}: {exc}")
        raise RuntimeError("Unable to load face model. " + " | ".join(errors))

    async def detect(self, image):
        if self.app is None:
            raise RuntimeError("Face model is not loaded")
        async with self._lock:
            return await asyncio.to_thread(self.app.get, image, max_num=self.max_faces)

    @property
    def loaded(self):
        return self.app is not None

    def files(self):
        model_dir = os.path.join(self.root, "models", self.name)
        if not os.path.isdir(model_dir):
            return []
        return sorted(os.path.relpath(os.path.join(root, name), model_dir)
                      for root, _, names in os.walk(model_dir) for name in names)


face_model = FaceModel()
