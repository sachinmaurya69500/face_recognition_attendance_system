# GPU runtime

FaceAttend now runs the face model on NVIDIA CUDA by default. The API service
uses `backend/Dockerfile.gpu`, requests all GPUs through Compose, and requires
the ONNX Runtime `CUDAExecutionProvider`; it will fail startup instead of
silently falling back to CPU.

Verify the host first:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 nvidia-smi
```

Start FaceAttend:

```bash
docker compose down --remove-orphans
DB_HOST_PORT=5434 docker compose up --build
```

Verify the active provider:

```bash
curl http://localhost:8080/model
```

The response must contain `CUDAExecutionProvider` in `providers`. If the host
does not have an NVIDIA GPU, NVIDIA Container Toolkit, or a compatible driver,
the API is intentionally prevented from starting.
