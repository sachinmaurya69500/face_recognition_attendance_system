# GPU runtime

Pratyaksh uses NVIDIA CUDA for face recognition. The default deployment uses
`backend/Dockerfile.gpu`, requests all GPUs through Compose, and requires the
ONNX Runtime CUDA provider.

Verify the host:

```bash
nvidia-smi
docker run --rm --gpus all nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04 nvidia-smi
```

Deploy through Cloudflare Tunnel:

```bash
./scripts/start-quick-tunnel.sh
```

Verify the GPU provider and public API:

```bash
docker compose -f docker-compose.gpu.yml exec -T api \
  python -c 'import onnxruntime as ort; print(ort.get_available_providers())'
curl https://attendai.sachinmaurya.me/health
```

The provider list must include `CUDAExecutionProvider`.
