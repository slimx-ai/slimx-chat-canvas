from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from gradio_client import Client 
import sys

app = FastAPI()

class ChatRequest(BaseModel):
    prompt: str

GRADIO_URL = "https://gpt.baby-gpt.com"

print("Initializing Gradio Client connection...", flush=True)
try:
    gradio_client = Client(GRADIO_URL)
    print("Gradio Client connection established successfully.", flush=True)
except Exception as e:
    print(f"Failed to initialize Gradio Client: {e}", flush=True)

# REMOVED 'async' to allow FastAPI to process this on an isolated thread pool
@app.post("/api/chat")
def chat_endpoint(payload: ChatRequest):
    print(f"\n--- New Chat Request Received ---", flush=True)
    print(f"Payload Prompt passed to Backend:\n{payload.prompt}", flush=True)
    
    try: 
        print("Forwarding payload to upstream Gradio model...", flush=True)
        
        # Call upstream model
        result = gradio_client.predict(
            prompt=payload.prompt, 
            model_choice="babyGPT_152M_125h.llm",
            api_name="/gradio_interface"
        )
        
        print(f"Upstream response successfully received type: {type(result)}", flush=True)
        print(f"Raw Upstream Result content: {result}", flush=True)
        
        return {"reply": str(result)}
        
    except Exception as e:
        print(f"ERROR during Gradio API prediction phase: {str(e)}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))

# Mount static web directory assets
app.mount("/", StaticFiles(directory="static", html=True), name="static")
