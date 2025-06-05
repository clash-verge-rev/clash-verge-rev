use crate::bitmap;
use crate::error::Result;
use crate::{error::RuleParseError, utils, Parser, RuleBehavior, RuleFormat, RulePayload};
use byteorder::{BigEndian, ReadBytesExt};
use std::{
    io::{Cursor, Read},
    sync::{Arc, Mutex},
};

/// domain parse strategy
pub(crate) struct DomainParseStrategy;

impl Parser for DomainParseStrategy {
    fn parse(buf: &[u8], format: RuleFormat) -> Result<RulePayload> {
        match format {
            RuleFormat::Mrs => parse_from_mrs(buf),
            RuleFormat::Yaml => utils::parse_from_yaml(buf),
            RuleFormat::Text => utils::parse_from_text(buf),
        }
    }
}

#[derive(Debug, Default)]
struct DomainSet {
    leaves: Vec<u64>,
    label_bit_map: Vec<u64>,
    labels: Vec<u8>,
    ranks: Vec<i32>,
    selects: Vec<i32>,
}

impl DomainSet {
    fn new() -> Self {
        DomainSet::default()
    }

    fn init(&mut self) {
        let (selects, ranks) = bitmap::Bitmap::index_select_32_r64(&self.label_bit_map);
        self.selects = selects;
        self.ranks = ranks;
    }

    fn keys<F>(&self, mut f: F)
    where
        F: FnMut(&String) -> bool,
    {
        let mut current_key: Vec<char> = vec![];
        self.traverse(&mut current_key, 0, 0, &mut f);
    }

    fn traverse<F>(
        &self,
        current_key: &mut Vec<char>,
        node_id: isize,
        bm_idx: isize,
        f: &mut F,
    ) -> bool
    where
        F: FnMut(&String) -> bool,
    {
        if get_bit(&self.leaves, node_id) != 0 && !f(&current_key.iter().collect::<String>()) {
            return false;
        }

        let mut bm_idx = bm_idx;

        loop {
            if get_bit(&self.label_bit_map, bm_idx) != 0 {
                return true;
            }

            let index = (bm_idx - node_id) as usize;
            let next_label = self.labels[index];
            current_key.push(next_label as char);
            let next_node_id = count_zeros(&self.label_bit_map, &self.ranks, bm_idx + 1);
            let next_bm_idx = select_ith_one(
                &self.label_bit_map,
                &self.ranks,
                &self.selects,
                next_node_id - 1,
            ) + 1;

            if !self.traverse(current_key, next_node_id, next_bm_idx, f) {
                return false;
            }
            current_key.pop();
            bm_idx += 1;
        }
    }

    fn foreach<F: FnMut(String) -> bool>(&mut self, mut f: F) {
        self.keys(|key| {
            let reverse_key = key.chars().rev().collect::<String>();
            f(reverse_key)
        });
    }
}

fn get_bit(bm: &[u64], i: isize) -> u64 {
    bm[(i >> 6) as usize] & (1 << (i & 63))
}

fn count_zeros(bm: &[u64], ranks: &[i32], i: isize) -> isize {
    let (a, _) = bitmap::Bitmap::rank_64(bm, ranks, i as i32);
    i - a as isize
}

fn select_ith_one(bm: &[u64], ranks: &[i32], selects: &[i32], i: isize) -> isize {
    let (a, _) = bitmap::Bitmap::select_32_r64(bm, selects, ranks, i as i32);
    a as isize
}

fn parse_from_mrs(buf: &[u8]) -> Result<RulePayload> {
    // create ZSTD decoder
    let mut reader = zstd::Decoder::new(Cursor::new(buf))?;

    // validate mrs file
    let count = utils::validate_mrs(&mut reader, RuleBehavior::Domain)?;

    let mut domain_set = DomainSet::new();

    // version
    let mut version = [0u8; 1];
    reader.read_exact(&mut version)?;
    if version[0] != 1 {
        return Err(RuleParseError::InvalidVersion);
    }

    // leaves
    let length = reader.read_i64::<BigEndian>()?;
    if length < 0 {
        return Err(RuleParseError::InvalidLength(length));
    }
    let mut leaves = Vec::<u64>::with_capacity(length as usize);
    for _ in 0..length {
        let data = reader.read_u64::<BigEndian>()?;
        leaves.push(data);
    }
    domain_set.leaves = leaves;

    // label bitmap
    let length = reader.read_i64::<BigEndian>()?;
    if length < 0 {
        return Err(RuleParseError::InvalidLength(length));
    }
    let mut label_bit_map = Vec::<u64>::with_capacity(length as usize);
    for _ in 0..length {
        let data = reader.read_u64::<BigEndian>()?;
        label_bit_map.push(data);
    }
    domain_set.label_bit_map = label_bit_map;

    // labels
    let length = reader.read_i64::<BigEndian>()?;
    if length < 0 {
        return Err(RuleParseError::InvalidLength(length));
    }
    let mut labels = Vec::new();
    reader.read_to_end(&mut labels)?;
    domain_set.labels = labels;
    domain_set.init();

    // get rules
    let mut rules: Vec<String> = vec![];
    let keys = Arc::new(Mutex::new(Vec::new()));
    let keys_ = Arc::clone(&keys);
    domain_set.foreach(move |key| {
        keys_.lock().unwrap().push(key);
        true
    });
    let mut keys = keys.lock().unwrap();
    keys.sort();

    for key in keys.iter() {
        let search_str = "+.".to_string() + key;
        if keys.binary_search(&search_str).is_ok() {
            continue;
        }
        rules.push(key.clone());
    }

    Ok(RulePayload { count, rules })
}

#[cfg(test)]
#[allow(deprecated)]
mod tests {

    use crate::error::Result;

    use super::*;

    #[test]
    fn test_domain_parse_from_mrs() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = home_dir.join("Downloads/meta-rules-dat/geo/geosite/aliyun.mrs");
        let buf = std::fs::read(path)?;
        let payload = DomainParseStrategy::parse(&buf, RuleFormat::Mrs)?;
        println!("payload: {:?}", payload);
        Ok(())
    }

    #[test]
    fn test_domain_parse_from_yaml() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = home_dir.join("Downloads/meta-rules-dat/geo/geosite/aliyun.yaml");
        let buf = std::fs::read(path)?;
        let payload = DomainParseStrategy::parse(&buf, RuleFormat::Yaml)?;
        println!("payload: {:?}", payload);
        Ok(())
    }

    #[test]
    fn test_domain_parse_from_text() -> Result<()> {
        let home_dir = std::env::home_dir().expect("failed to get home dir");
        let path = home_dir.join("Downloads/meta-rules-dat/geo/geosite/aliyun.txt");
        let buf = std::fs::read(path)?;
        let payload = DomainParseStrategy::parse(&buf, RuleFormat::Text)?;
        println!("payload: {:?}", payload);
        Ok(())
    }
}
