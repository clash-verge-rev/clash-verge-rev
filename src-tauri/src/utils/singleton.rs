/// Implements `global()` using the supplied `OnceCell` static.
#[macro_export]
macro_rules! singleton {
    ($struct_name:ty, $instance_name:ident) => {
        static $instance_name: std::sync::OnceLock<$struct_name> = std::sync::OnceLock::new();

        impl $struct_name {
            pub fn global() -> &'static $struct_name {
                $instance_name.get_or_init(|| Self::new())
            }
        }
    };

    ($struct_name:ty, $instance_name:ident, $init_expr:expr) => {
        static $instance_name: std::sync::OnceLock<$struct_name> = std::sync::OnceLock::new();

        impl $struct_name {
            pub fn global() -> &'static $struct_name {
                $instance_name.get_or_init(|| $init_expr)
            }
        }
    };
}
