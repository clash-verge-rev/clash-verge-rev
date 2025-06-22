import { initializeClerk, signIn, signUp } from "@/services/clerk";
import { handleSessionConflict, safeSignIn } from "@/services/session-manager";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  IconButton,
  InputAdornment,
  Link,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

interface LoginFormProps {
  onSuccess?: () => void;
}

export const LoginForm: React.FC<LoginFormProps> = ({ onSuccess }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const navigate = useNavigate();
  
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    confirmPassword: "",
  });

  // 检查用户是否已经登录
  useEffect(() => {
    const checkLoginStatus = async () => {
      try {
        await initializeClerk();
        
        const sessionStatus = await handleSessionConflict();
        if (sessionStatus === 'signed_in') {
          console.log('用户已登录，重定向到首页');
          navigate("/home");
          return;
        }
      } catch (error) {
        console.error('检查登录状态失败:', error);
      }
    };
    
    checkLoginStatus();
  }, [navigate]);

  const handleInputChange = (field: string) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [field]: event.target.value
    }));
    // Clear error when user starts typing
    if (error) setError("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    
    if (!formData.email || !formData.password) {
      setError(t("Please fill in all required fields"));
      return;
    }

    if (isSignUp && formData.password !== formData.confirmPassword) {
      setError(t("Passwords do not match"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 确保 Clerk 已初始化
      await initializeClerk();
      
      if (isSignUp) {
        // 注册逻辑
        const result = await safeSignIn(async () => {
          return await signUp(formData.email, formData.password);
        });
        
        console.log('Sign up result:', result);
        
        // Handle verification if needed
        if (result.status === 'missing_requirements') {
          setError(t("auth.verificationRequired"));
          return;
        } else if (result.status !== 'complete') {
          setError(t("auth.signUpIncomplete"));
          return;
        }
      } else {
        // 登录逻辑
        const result = await safeSignIn(async () => {
          return await signIn(formData.email, formData.password);
        });
        
        console.log('Sign in result:', result);
      }
      
      // Success - redirect to home
      navigate("/home");
      onSuccess?.();
      
    } catch (err: any) {
      console.error("Authentication error:", err);
      
      // 处理会话存在错误
      if (err?.message === 'SESSION_EXISTS' || 
          err?.message?.includes('用户已登录') ||
          (err?.errors && err.errors[0]?.code === 'session_exists')) {
        setError(t("auth.alreadySignedIn"));
        // 如果已经存在会话，直接跳转到首页
        navigate("/home");
        return;
      }
      
      // 处理其他错误
      if (err?.message?.includes('Identifier is invalid')) {
        setError(t("auth.invalidCredentials"));
      } else if (err?.message?.includes('Password is incorrect')) {
        setError(t("auth.invalidCredentials"));
      } else if (err?.message?.includes('Clerk not initialized')) {
        setError(t("auth.initializationError"));
      } else if (err?.message?.includes('network')) {
        setError(t("auth.networkError"));
      } else {
        setError(err?.message || t("Authentication failed"));
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp(!isSignUp);
    setError("");
    setFormData(prev => ({ ...prev, confirmPassword: "" }));
  };

  const togglePasswordVisibility = () => {
    setShowPassword(!showPassword);
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        width: "100%",
        maxWidth: 450,
        p: 4,
        borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
        backgroundColor: alpha(theme.palette.background.paper, 0.8),
        backdropFilter: "blur(8px)",
        boxShadow: "none",
      }}
    >
      {/* Header */}
      <Box sx={{ mb: 3, textAlign: "center" }}>
        <Typography
          variant="h4"
          component="h1"
          sx={{ fontWeight: 600, mb: 1 }}
        >
          {isSignUp ? t("Create Account") : t("Welcome Back")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {isSignUp 
            ? t("Sign up to get started with your account") 
            : t("Sign in to your account to continue")
          }
        </Typography>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Email Field */}
      <TextField
        fullWidth
        label={t("Email Address")}
        type="email"
        value={formData.email}
        onChange={handleInputChange("email")}
        margin="normal"
        required
        disabled={loading}
        autoComplete="email"
      />

      {/* Password Field */}
      <TextField
        fullWidth
        label={t("Password")}
        type={showPassword ? "text" : "password"}
        value={formData.password}
        onChange={handleInputChange("password")}
        margin="normal"
        required
        disabled={loading}
        autoComplete={isSignUp ? "new-password" : "current-password"}
        InputProps={{
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                onClick={togglePasswordVisibility}
                disabled={loading}
                edge="end"
              >
                {showPassword ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        }}
      />

      {/* Confirm Password Field (Sign Up Only) */}
      {isSignUp && (
        <TextField
          fullWidth
          label={t("Confirm Password")}
          type={showPassword ? "text" : "password"}
          value={formData.confirmPassword}
          onChange={handleInputChange("confirmPassword")}
          margin="normal"
          required
          disabled={loading}
          autoComplete="new-password"
        />
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        fullWidth
        variant="contained"
        size="large"
        disabled={loading}
        sx={{
          mt: 3,
          mb: 2,
          py: 1.5,
          backgroundColor: theme.palette.primary.main,
          "&:hover": {
            backgroundColor: theme.palette.primary.dark,
          },
        }}
      >
        {loading 
          ? t("Please wait...") 
          : isSignUp 
            ? t("Create Account") 
            : t("Sign In")
        }
      </Button>

      {/* Toggle Mode */}
      <Box sx={{ textAlign: "center" }}>
        <Typography variant="body2" color="text.secondary">
          {isSignUp ? t("Already have an account?") : t("Don't have an account?")}{" "}
          <Link
            component="button"
            type="button"
            onClick={toggleMode}
            disabled={loading}
            sx={{
              color: theme.palette.primary.main,
              textDecoration: "none",
              "&:hover": {
                color: theme.palette.primary.dark,
                textDecoration: "underline",
              },
            }}
          >
            {isSignUp ? t("Sign In") : t("Sign Up")}
          </Link>
        </Typography>
      </Box>
    </Box>
  );
}; 