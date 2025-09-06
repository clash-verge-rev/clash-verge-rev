use std::{
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};

pub fn init_meta_rules() -> Result<PathBuf, Box<dyn std::error::Error>> {
    let tmp_dir = std::env::temp_dir();
    let rules_dir = tmp_dir.join("meta-rules-dat");
    let exists = std::fs::exists(&rules_dir)?;
    if exists {
        let commands: Vec<Vec<&str>> = vec![vec!["restore", "."], vec!["clean", "-fd"], vec!["pull"]];
        commands.iter().for_each(|args| {
            Command::new("git")
                .args(args)
                .current_dir(&rules_dir)
                .spawn()
                .expect("failed to spawn command")
                .wait()
                .expect("command not running");
        });
    } else {
        Command::new("git")
            .args(["clone", "-b", "meta", "https://github.com/MetaCubeX/meta-rules-dat.git"])
            .current_dir(&tmp_dir)
            .spawn()
            .expect("failed to clone rules")
            .wait()
            .expect("command not running");
    }
    Ok(rules_dir)
}

/// Check if the contents of the src file are different from the contents of the target file
pub fn check_diff<P: AsRef<Path>>(src_file: P, target_file: P) -> Result<(), String> {
    let mut src_str = String::new();
    std::fs::File::open(src_file.as_ref())
        .map_err(|_| "src file not found".to_string())?
        .read_to_string(&mut src_str)
        .map_err(|_| "read src file error".to_string())?;
    let src_lines = src_str
        .trim()
        .split('\n')
        .map(|s| s.to_owned())
        .collect::<Vec<String>>();

    let mut target_str = String::new();
    std::fs::File::open(target_file.as_ref())
        .map_err(|_| "target file not found".to_string())?
        .read_to_string(&mut target_str)
        .map_err(|_| "read target file error".to_string())?;
    let target_lines = target_str
        .trim()
        .split('\n')
        .map(|s| s.to_owned())
        .collect::<Vec<String>>();

    if src_lines.len() != target_lines.len() {
        return Err(format!(
            "content length not equals\n  src: {}\n  target: {}",
            src_lines.len(),
            target_lines.len()
        ));
    }

    let total = src_lines.len();
    for i in 0..total {
        let src_val = &src_lines[i];
        let target_val = &target_lines[i];
        if src_val != target_val {
            return Err(format!(
                "value not the same\n  index {}\n  src: {}\n  target: {}",
                i, src_val, target_val
            ));
        }
    }
    Ok(())
}
