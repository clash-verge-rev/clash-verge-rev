pub mod iruntime {
    use im::{HashMap, HashSet, Vector};
    use smartstring::alias::String;

    type Logs = Vector<(String, String)>;
    pub type ExistsKeys = HashSet<String>;
    pub type ChainLogs = HashMap<String, Logs>;
}
