use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Sequence, Value};
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeqMap {
    prepend: Sequence,
    append: Sequence,
    delete: Sequence,
}

pub fn use_seq(seq_map: SeqMap, config: Mapping, name: &str) -> Mapping {
    let prepend = seq_map.prepend;
    let append = seq_map.append;
    let delete = seq_map.delete;

    let origin_seq = config.get(&name).map_or(Sequence::default(), |val| {
        val.as_sequence().unwrap().clone()
    });
    let mut seq = origin_seq.clone();

    for item in prepend {
        seq.insert(0, item);
    }

    for item in append {
        seq.push(item);
    }

    for item in delete {
        seq.retain(|x| x != &item);
    }
    let mut config = config.clone();
    config.insert(Value::from(name), Value::from(seq));
    return config;
}
