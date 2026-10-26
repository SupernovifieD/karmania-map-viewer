//! Karmania core: the standard data model for the six map data shapes and the
//! validator that checks them.
//!
//! This crate performs no I/O, contains no WebAssembly-specific code and keeps
//! no global state, so the same code can later be bound to other languages.

#![forbid(unsafe_code)]

#[cfg(test)]
mod tests {
    #[test]
    fn crate_identity() {
        assert_eq!(env!("CARGO_PKG_NAME"), "karmania-core");
    }
}
