use serde::{Deserialize, Serialize};
use serde_yaml::{Mapping, Sequence, Value};
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SeqMap {
    prepend: Sequence,
    append: Sequence,
    delete: Sequence,
}

pub fn use_seq(seq_map: SeqMap, config: Mapping, name: &str) -> Mapping {
    let mut prepend = seq_map.prepend;
    let append = seq_map.append;
    let delete = seq_map.delete;

    let origin_seq = config.get(name).map_or(Sequence::default(), |val| {
        val.as_sequence().unwrap_or(&Sequence::default()).clone()
    });
    let mut seq = origin_seq.clone();

    let mut delete_names = Vec::new();
    for item in delete {
        let item = item.clone();
        if let Some(name) = if item.is_string() {
            Some(item)
        } else {
            item.get("name").cloned()
        } {
            delete_names.push(name.clone());
        }
    }
    seq.retain(|x| {
        if let Some(x_name) = if x.is_string() {
            Some(x)
        } else {
            x.get("name")
        } {
            !delete_names.contains(x_name)
        } else {
            true
        }
    });

    prepend.reverse();
    for item in prepend {
        seq.insert(0, item);
    }

    for item in append {
        seq.push(item);
    }

    let mut config = config.clone();
    config.insert(Value::from(name), Value::from(seq));
    config
}
