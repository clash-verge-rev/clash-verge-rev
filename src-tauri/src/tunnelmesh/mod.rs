//! Embedded TunnelMesh client.

pub mod config;
pub mod forward;
pub mod manager;
pub mod pool;
pub mod protocol;
mod protocol_codec;
pub mod runtime;
pub mod session;
pub mod transport;

pub use protocol::*;
#[allow(unused_imports)]
pub use protocol_codec::*;

#[cfg(test)]
#[allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::unused_trait_names,
    clippy::result_large_err,
    clippy::clone_on_ref_ptr
)]
mod protocol_test;
#[cfg(test)]
#[allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::unused_trait_names,
    clippy::result_large_err,
    clippy::clone_on_ref_ptr
)]
mod session_test;
#[cfg(test)]
#[allow(
    clippy::expect_used,
    clippy::unwrap_used,
    clippy::unused_trait_names,
    clippy::result_large_err,
    clippy::clone_on_ref_ptr
)]
mod transport_test;
