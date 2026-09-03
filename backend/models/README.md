# InsightFace model weights

The `buffalo_l` detector and ArcFace recognition weights are downloaded by
`backend/Dockerfile` into `/workspace/models/buffalo_l` during
`docker compose build`. Binary model files are intentionally not committed to
the repository. The running API reports the active model and files at
`GET /model`.
