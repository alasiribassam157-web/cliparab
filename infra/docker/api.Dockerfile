# API + worker image (same image, different command). Build from the repo root:
#   docker build -f infra/docker/api.Dockerfile -t cliparab-api .
# Add Whisper for local transcription:  --build-arg WITH_WHISPER=1
# yt-dlp (import from a link) is included; drop it with:  --build-arg WITH_YTDLP=0
FROM python:3.12-slim

ARG WITH_WHISPER=0
ARG WITH_YTDLP=1
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 DATA_DIR=/data CLIPARAB_FONTS_DIR=/usr/local/share/fonts/cliparab

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fontconfig fonts-noto-core fonts-dejavu-core curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY packages/core /app/packages/core
COPY apps/api /app/apps/api
COPY assets/fonts /usr/local/share/fonts/cliparab
COPY scripts/fetch-fonts.sh /tmp/fetch-fonts.sh
# Tajawal is optional (best effort); Noto Sans Arabic from fonts-noto-core is the guaranteed fallback.
RUN (/tmp/fetch-fonts.sh /usr/local/share/fonts/cliparab || true) && fc-cache -f

RUN pip install /app/packages/core /app/apps/api opencv-python-headless \
    && if [ "$WITH_WHISPER" = "1" ]; then pip install "/app/packages/core[whisper]"; fi \
    && if [ "$WITH_YTDLP" = "1" ]; then pip install yt-dlp; fi

VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD curl -fsS http://localhost:8000/healthz || exit 1
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app/apps/api"]
