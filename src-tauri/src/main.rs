#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    clash_verge_lib::run().unwrap();
}
