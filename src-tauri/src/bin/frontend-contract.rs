//! Prints the frontend wire contract as JSON to stdout. Zero new dependencies:
//! the payload is derived from the same serializers the app uses at runtime.
//! Consumed by scripts/gen-contract.mjs; CI regenerates and diffs the committed
//! TypeScript artifact.

fn main() {
    println!("{}", app_lib::frontend_wire_contract());
}
