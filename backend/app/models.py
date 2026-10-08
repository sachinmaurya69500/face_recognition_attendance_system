"""Face detection and embedding model service.

This module owns InsightFace model loading and serialized GPU/CPU inference. API
routes should use FaceModel.detect() instead of accessing model internals.
"""

import asyncio
import logging
import os
from pathlib import Path

import cv2
from insightface.app import FaceAnalysis
import onnxruntime as ort

logger = logging.getLogger("pratyaksh.face_model")


class FaceModel:
    def __init__(self):
        self.name = os.getenv("INSIGHTFACE_MODEL", "buffalo_l")
        # Docker explicitly sets /workspace.  When started directly with
        # `uvicorn app.main:app`, keep downloaded weights under backend/models
        # instead of attempting to create the Docker-only /workspace path.
        native_root = str(Path(__file__).resolve().parents[1])
        self.root = os.getenv("INSIGHTFACE_ROOT", native_root)
        self.max_faces = int(os.getenv("MAX_FACES", "300"))
        # This is a proposal threshold inside RetinaFace, not a security
        # confidence setting. Values near 0.8-0.99 starve the landmark and
        # embedding stages, especially on phone camera frames. High-accuracy
        # filtering is applied by the API after a face has been detected.
        requested_threshold = float(os.getenv("FACE_DET_THRESHOLD", "0.35"))
        self.det_threshold = min(max(requested_threshold, 0.15), 0.45)
        raw_det_size = int(os.getenv("FACE_DET_SIZE", "640"))
        # 640 is standard RetinaFace resolution for phone & webcam frames.
        self.det_size = 640 if raw_det_size > 1000 else raw_det_size
        # Face recognition is GPU-only by default. Set REQUIRE_GPU=0 only for
        # an explicit CPU troubleshooting/development override.
        self.require_gpu = os.getenv("REQUIRE_GPU", "1").lower() in {"1", "true", "yes"}
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

        # GPU deployments must never silently downgrade to CPU: that would
        # hide a broken NVIDIA runtime and make production latency unpredictable.
        attempts = [self._provider_candidates]
        if not self.require_gpu and "CPUExecutionProvider" in self._provider_candidates:
            attempts.append(["CPUExecutionProvider"])
        errors = []
        for providers in attempts:
            try:
                model = FaceAnalysis(name=self.name, root=self.root, providers=providers)
                # Pass the threshold into InsightFace itself so low-quality
                # proposals are filtered before landmarks/embeddings are
                # produced. The detector then returns face.kps (five points).
                model.prepare(ctx_id=0, det_thresh=self.det_threshold, det_size=(self.det_size, self.det_size))
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
            det_model = getattr(self.app, "det_model", None)

            # 1. Standard detection at 640x640 native scale
            if det_model is not None:
                det_model.input_size = (640, 640)
            faces = await asyncio.to_thread(self.app.get, image, max_num=self.max_faces)
            if faces:
                return faces

            # 2. Try alternate color order (BGR <-> RGB)
            alternate = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            faces = await asyncio.to_thread(self.app.get, alternate, max_num=self.max_faces)
            if faces:
                return faces

            # 3. Multi-scale fallback (1280x1280 for distant / high-res / group faces)
            if det_model is not None:
                det_model.input_size = (1280, 1280)
                faces = await asyncio.to_thread(self.app.get, image, max_num=self.max_faces)
                if faces:
                    det_model.input_size = (640, 640)
                    return faces
                faces = await asyncio.to_thread(self.app.get, alternate, max_num=self.max_faces)
                if faces:
                    det_model.input_size = (640, 640)
                    return faces

                # 4. Multi-scale fallback (320x320 for tight selfie / cropped webcam frames)
                det_model.input_size = (320, 320)
                faces = await asyncio.to_thread(self.app.get, image, max_num=self.max_faces)
                if faces:
                    det_model.input_size = (640, 640)
                    return faces
                faces = await asyncio.to_thread(self.app.get, alternate, max_num=self.max_faces)
                if faces:
                    det_model.input_size = (640, 640)
                    return faces

                # Restore standard scale
                det_model.input_size = (640, 640)

            return []

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
