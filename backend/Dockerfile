FROM python:3.10-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
ENV INSIGHTFACE_ROOT=/workspace
RUN mkdir -p /workspace/models

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Pre-download SCRFD & ArcFace models inside the image build layer
RUN python -c "import os; from insightface.app import FaceAnalysis; FaceAnalysis(name='buffalo_l', root=os.environ['INSIGHTFACE_ROOT']).prepare(ctx_id=0, det_size=(1600, 1600))"

# Keep model weights in a named runtime volume while retaining the baked-in
# weights as the image fallback for first startup.
VOLUME ["/workspace/models"]

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
