FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PORT=8080

WORKDIR /app

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

EXPOSE 8080

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]