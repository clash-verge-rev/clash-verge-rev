/// Macro to generate singleton pattern for structs
///
/// Usage:
/// ```rust,ignore
/// use crate::utils::singleton::singleton;
///
/// struct MyStruct {
///     value: i32,
/// }
/// impl MyStruct {
///     fn new() -> Self {
///         MyStruct { value: 0 }
///     }
/// }
/// singleton!(MyStruct, INSTANCE);
/// ```
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

/// Macro for singleton pattern with logging
#[macro_export]
macro_rules! singleton_with_logging {
    ($struct_name:ty, $instance_name:ident, $struct_name_str:literal) => {
        static $instance_name: std::sync::OnceLock<$struct_name> = std::sync::OnceLock::new();

        impl $struct_name {
            pub fn global() -> &'static $struct_name {
                $instance_name.get_or_init(|| {
                    let instance = Self::new();
                    $crate::logging!(
                        info,
                        $crate::utils::logging::Type::Setup,
                        concat!($struct_name_str, " initialized")
                    );
                    instance
                })
            }
        }
    };
}

/// Macro for singleton pattern with lazy initialization using a closure
/// This replaces patterns like lazy_static! or complex OnceLock initialization
#[macro_export]
macro_rules! singleton_lazy {
    ($struct_name:ty, $instance_name:ident, $init_closure:expr) => {
        static $instance_name: std::sync::OnceLock<$struct_name> = std::sync::OnceLock::new();

        impl $struct_name {
            pub fn global() -> &'static $struct_name {
                $instance_name.get_or_init($init_closure)
            }
        }
    };
}

/// Macro for singleton pattern with lazy initialization and logging
#[macro_export]
macro_rules! singleton_lazy_with_logging {
    ($struct_name:ty, $instance_name:ident, $struct_name_str:literal, $init_closure:expr) => {
        static $instance_name: std::sync::OnceLock<$struct_name> = std::sync::OnceLock::new();

        impl $struct_name {
            pub fn global() -> &'static $struct_name {
                $instance_name.get_or_init(|| {
                    let instance = $init_closure();
                    $crate::logging!(
                        info,
                        $crate::utils::logging::Type::Setup,
                        concat!($struct_name_str, " initialized")
                    );
                    instance
                })
            }
        }
    };
}

#[cfg(test)]
mod tests {
    struct TestStruct {
        value: i32,
    }

    impl TestStruct {
        fn new() -> Self {
            Self { value: 42 }
        }
    }

    singleton!(TestStruct, TEST_INSTANCE);

    #[test]
    fn test_singleton_macro() {
        let instance1 = TestStruct::global();
        let instance2 = TestStruct::global();

        assert_eq!(instance1.value, 42);
        assert_eq!(instance2.value, 42);
        assert!(std::ptr::eq(instance1, instance2));
    }
}
