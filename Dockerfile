FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

WORKDIR /app

# git is required to install the `slimx` dependency from its Git URL.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git curl build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/requirements.txt
COPY requirements-toaster-cpu.txt /app/requirements-toaster-cpu.txt

# Install the CPU-only PyTorch wheel first. Plain `pip install torch` pulls the
# CUDA build (~2.5GB of unused NVIDIA libraries); the CPU index is a fraction of
# that. The subsequent requirements install then sees torch already satisfied.
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r /app/requirements-toaster-cpu.txt

COPY app /app/app
COPY config /app/config
COPY model /app/model
COPY tokenizer_lib /app/tokenizer_lib
COPY static /app/static
COPY server.py /app/server.py

# Run as an unprivileged user. The model checkpoint is mounted read-only at
# runtime, so the app never needs write access to it.
RUN useradd --create-home --shell /usr/sbin/nologin appuser \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8080

# Container-level health probe. Uses the app's own /health route via stdlib so
# no extra packages are required. start-period is generous because the slimx
# backend warms the model on startup.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8080')+'/health', timeout=3).read()"

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
