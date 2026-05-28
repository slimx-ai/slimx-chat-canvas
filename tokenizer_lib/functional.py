import numpy as np
import tiktoken

enc = None
eot = None


def init_gpt2_tokenizer():
    global enc, eot
    enc = tiktoken.get_encoding("gpt2")
    eot = enc._special_tokens["<|endoftext|>"]


def _ensure_tokenizer():
    if enc is None:
        init_gpt2_tokenizer()


def gpt2_encode(doc, dtype=np.uint16):
    prompt = {"text": doc}
    return gpt2_encode_hf(prompt, dtype=dtype)


def gpt2_encode_hf(doc, dtype=np.uint16):
    _ensure_tokenizer()
    if "text" not in doc:
        raise ValueError("Document must have a 'text' key")
    tokens = [eot]
    tokens.extend(enc.encode_ordinary(doc["text"]))
    tokens_np = np.array(tokens, dtype=dtype)
    return tokens_np


def gpt2_decode(tokens):
    _ensure_tokenizer()
    if hasattr(tokens, "tolist"):
        tokens = tokens.tolist()
    tokens = [int(t) for t in tokens]
    if not tokens:
        return ""
    if eot is not None and tokens[0] == eot:
        tokens = tokens[1:]
    return enc.decode(tokens)
