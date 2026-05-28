import logging
from dataclasses import asdict, dataclass, field, fields
from typing import Optional

import yaml

config_logger = logging.getLogger(__name__)


@dataclass
class DataConfig:
    dataset_name: str = "HuggingFaceFW/fineweb-edu"
    split_ratio: float = 0.98
    tokenized_data: str = "../../dataspace/fineweb"
    remote_name: str = "sample-10BT"
    shard_size: int = int(1e7)


@dataclass
class InferenceConfig:
    pretrained_model: str = "babyGPT_152M"
    pretrained_model_config: str = "babyGPT_152M_config"
    generate_max_length: int = 50

    @property
    def babyGPT_name(self) -> str:
        return self.pretrained_model

    @property
    def babyGPT_config(self) -> str:
        return self.pretrained_model_config


@dataclass
class TrainingConfig:
    n_batches: int = 16
    batch_size: int = 6
    n_embd: int = 768
    n_head: int = 8
    n_blocks: int = 16
    seq_len: int = 1024
    lr: float = 0.0006
    dropout_rate: float = 0.2
    log_inter: int = 20
    eval_inter: int = 200
    eval_iter: int = 10
    max_iter: int = 100_000
    dtype: str = "long"
    tokenizer_type: str = "gpt2"
    tokenizer_dir: str = "checkpoints/tokenizer_dir"
    ckpt: str = "checkpoints/ckpt"
    ckpt_config: str = "checkpoints/ckpt_config.yaml"
    ckpt_dir: str = "model/checkpoints"
    ckpt_model: str = "model_tmp"
    current_shard: int = 0
    training_step: int = 0
    training_duration: float = 0.0
    log_file: str = "log.txt"
    data_dir: str = "dataspace/tokenized_data"
    num_workers: int = 1
    max_loss: float = field(default_factory=lambda: float("inf"))
    device: Optional[str] = None
    vocab_size: Optional[int] = None

    def validate(self):
        assert self.batch_size > 0, "Batch size must be positive"


@dataclass
class ConfigHandler:
    training: TrainingConfig = field(default_factory=TrainingConfig)
    data: DataConfig = field(default_factory=DataConfig)
    inference: InferenceConfig = field(default_factory=InferenceConfig)

    @staticmethod
    def from_yaml(filepath: str) -> "ConfigHandler":
        config_logger.info("Loading configuration from %s", filepath)
        with open(filepath, "r", encoding="utf-8") as f:
            yaml_dict = yaml.safe_load(f) or {}

        config = ConfigHandler()

        # Supports both current sectioned config and older flat babyGPT_152M_config files.
        if any(k in yaml_dict for k in ("training", "data", "inference")):
            config.training = TrainingConfig(**(yaml_dict.get("training", {}) or {}))
            config.data = DataConfig(**(yaml_dict.get("data", {}) or {}))
            config.inference = InferenceConfig(**(yaml_dict.get("inference", {}) or {}))
        else:
            training_field_names = {f.name for f in fields(TrainingConfig)}
            training_values = {k: v for k, v in yaml_dict.items() if k in training_field_names}
            config.training = TrainingConfig(**training_values)
        return config

    @staticmethod
    def load(filepath: str) -> "ConfigHandler":
        return ConfigHandler.from_yaml(str(filepath))

    def to_yaml(self, filepath: str):
        with open(filepath, "w", encoding="utf-8") as f:
            yaml.dump(asdict(self), f, indent=4)
