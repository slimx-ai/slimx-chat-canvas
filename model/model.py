import torch
import torch.nn as nn
from torch.nn import functional as F


class FlashAttention(nn.Module):
    def __init__(self, n_head: int, n_embd: int, seq_len: int, attn_pdrop: float, causal: bool, device: str):
        super().__init__()
        assert n_embd % n_head == 0, "Embedding size must be divisible by number of heads"
        self.n_head = n_head
        self.head_dim = n_embd // n_head
        self.causal = causal
        self.qkv_proj = nn.Linear(n_embd, 3 * n_embd)
        self.output_proj = nn.Linear(n_embd, n_embd)
        self.dropout = nn.Dropout(attn_pdrop)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.size()
        qkv = self.qkv_proj(x).chunk(3, dim=-1)
        q, k, v = [t.view(B, T, self.n_head, self.head_dim).transpose(1, 2) for t in qkv]
        attn_output = F.scaled_dot_product_attention(q, k, v, is_causal=self.causal)
        attn_output = attn_output.transpose(1, 2).contiguous().view(B, T, C)
        return self.output_proj(self.dropout(attn_output))


class SelfAttention(nn.Module):
    def __init__(self, n_head: int, n_embd: int, seq_len: int, attn_pdrop: float, causal: bool, device: str):
        super().__init__()
        assert n_embd % n_head == 0, "Embedding size must be divisible by number of heads"
        self.c_attn = nn.Linear(n_embd, 3 * n_embd)
        self.c_proj = nn.Linear(n_embd, n_embd)
        self.n_head = n_head
        self.n_embd = n_embd
        self.dropout = nn.Dropout(attn_pdrop)
        self.causal = causal
        if self.causal:
            self.register_buffer("bias", torch.tril(torch.ones(seq_len, seq_len)).view(1, 1, seq_len, seq_len))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        B, T, C = x.size()
        qkv = self.c_attn(x).chunk(3, dim=2)
        q, k, v = [t.view(B, T, self.n_head, C // self.n_head).transpose(1, 2) for t in qkv]
        att = (q @ k.transpose(-2, -1)) * (1.0 / (k.size(-1) ** 0.5))
        if self.causal:
            att = att.masked_fill(self.bias[:, :, :T, :T] == 0, float("-inf"))
        att = torch.softmax(att, dim=-1)
        att = self.dropout(att)
        y = att @ v
        y = y.transpose(1, 2).contiguous().view(B, T, C)
        return self.c_proj(y)


class FeedForwardLayer(nn.Module):
    def __init__(self, n_embd: int, hidden_dim: int, dropout_rate: float = 0.0):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_embd, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, n_embd),
            nn.Dropout(dropout_rate),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


class TransformerBlock(nn.Module):
    def __init__(self, n_head: int, n_embd: int, seq_len: int, dropout_rate: float, device: str, decoder: bool):
        super().__init__()
        self.norm1 = nn.LayerNorm(n_embd)
        self.norm2 = nn.LayerNorm(n_embd)
        self.attention = SelfAttention(n_head, n_embd, seq_len, dropout_rate, causal=decoder, device=device)
        self.feed_forward = FeedForwardLayer(n_embd, n_embd * 4, dropout_rate)
        self.dropout = nn.Dropout(dropout_rate)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = x + self.dropout(self.attention(self.norm1(x)))
        x = x + self.dropout(self.feed_forward(self.norm2(x)))
        return x


class TransformerModel(nn.Module):
    def __init__(self, n_head: int, vocab_size: int, n_embd: int, seq_len: int, device: str, dropout_rate: float = 0.0, n_blocks: int = 4, decoder: bool = False):
        super().__init__()
        self.token_embeddings = nn.Embedding(vocab_size, n_embd)
        self.position_embeddings = nn.Embedding(seq_len, n_embd)
        self.TransformerBlocks = nn.ModuleList(
            [TransformerBlock(n_head, n_embd, seq_len, dropout_rate, device, decoder) for _ in range(n_blocks)]
        )
        self.norm = nn.LayerNorm(n_embd)
        self.lm_head = nn.Linear(n_embd, vocab_size)
        self.token_embeddings.weight = self.lm_head.weight
        self.device = device
        self.seq_len = seq_len
        self.decoder = decoder

    def forward(self, input_indices: torch.Tensor) -> torch.Tensor:
        token_emb = self.token_embeddings(input_indices)
        position_emb = self.position_embeddings(torch.arange(input_indices.size(1), device=self.device))
        x = token_emb + position_emb
        for block in self.TransformerBlocks:
            x = block(x)
        x = self.norm(x)
        return self.lm_head(x)

    def generate_text(self, start_indices: torch.Tensor, max_length: int, topk: int = 35) -> torch.Tensor:
        # Kept for compatibility with llm_toaster, but the serving runtime uses its own loop.
        was_training = self.training
        self.eval()
        generated_indices = start_indices
        for _ in range(max_length):
            input_indices = generated_indices[:, -self.seq_len:]
            logits = self(input_indices)
            probabilities = torch.softmax(logits[:, -1, :], dim=-1)
            topk_p, topk_i = torch.topk(probabilities, topk, dim=-1)
            next_index = torch.multinomial(topk_p, num_samples=1)
            next_index = torch.gather(topk_i, 1, next_index)
            generated_indices = torch.cat((generated_indices, next_index), dim=1)
        if was_training:
            self.train()
        else:
            self.eval()
        return generated_indices
