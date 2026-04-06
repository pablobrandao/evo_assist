import json
import re
import sys
import unicodedata

import torch
from transformers import AutoModel, AutoTokenizer


def mean_pooling(model_output, attention_mask):
    token_embeddings = model_output[0]
    mask = attention_mask.unsqueeze(-1).expand(token_embeddings.size()).float()
    summed = torch.sum(token_embeddings * mask, dim=1)
    counts = torch.clamp(mask.sum(dim=1), min=1e-9)
    return summed / counts


def main() -> int:
    payload = json.loads(sys.stdin.read())
    model_name = payload.get("model") or "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    raw_texts = payload.get("texts") or []

    if not raw_texts:
      raise ValueError("Campo 'texts' obrigatorio.")

    texts = [str(item or "") for item in raw_texts if str(item or "").strip()]
    if not texts:
      raise ValueError("Nenhum texto valido recebido para embedding.")

    tokenizer = AutoTokenizer.from_pretrained(model_name)
    model = AutoModel.from_pretrained(model_name)
    model.eval()

    embeddings = []

    for text in texts:
        cleaned = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F]", " ", text)
        cleaned = cleaned.encode("utf-8", "ignore").decode("utf-8", "ignore")
        cleaned = unicodedata.normalize("NFKC", cleaned)
        cleaned = "".join(ch if ch.isprintable() or ch in "\n\r\t" else " " for ch in cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        inputs = tokenizer(
            cleaned,
            padding=True,
            truncation=True,
            max_length=512,
            return_tensors="pt",
        )

        with torch.no_grad():
            output = model(**inputs)

        pooled = mean_pooling(output, inputs["attention_mask"])
        normalized = torch.nn.functional.normalize(pooled, p=2, dim=1)
        embeddings.append(normalized[0].cpu().tolist())

    sys.stdout.write(json.dumps({
        "model": model_name,
        "dimensions": len(embeddings[0]) if embeddings else 0,
        "embeddings": embeddings,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
