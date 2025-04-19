import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  CircularProgress,
  InputAdornment,
  IconButton,
  SvgIcon,
  Container,
  FormControlLabel,
  Checkbox,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/providers/auth-provider";
import { useThemeMode } from "@/services/states";
import { BasePage } from "@/components/base";
import LogoSvg from "@/assets/image/logo.svg?react";
import iconLight from "@/assets/image/icon_light.svg?react";
import iconDark from "@/assets/image/icon_dark.svg?react";

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = useThemeMode();
  
  // Form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [rememberMe, setRememberMe] = useState(
    localStorage.getItem("rememberMe") === "true"
  );
  
  // 加载保存的凭据
  useEffect(() => {
    if (localStorage.getItem("rememberMe") === "true") {
      const savedEmail = localStorage.getItem("savedEmail");
      const savedPassword = localStorage.getItem("savedPassword");
      
      if (savedEmail) setEmail(savedEmail);
      if (savedPassword) setPassword(savedPassword);
    }
  }, []);
  
  // 如果已经登录，直接跳转到首页 - 只在初始加载时检查
  useEffect(() => {
    if (auth.isLoggedIn) {
      navigate("/home", { replace: true });
    }
  }, []); // 只在组件挂载时运行一次
  
  const validateForm = () => {
    let isValid = true;
    
    // Email validation
    if (!email.trim()) {
      setEmailError(t("Email is required"));
      isValid = false;
    } else if (!/\S+@\S+\.\S+/.test(email)) {
      setEmailError(t("Please enter a valid email"));
      isValid = false;
    } else {
      setEmailError("");
    }
    
    // Password validation
    if (!password) {
      setPasswordError(t("Password is required"));
      isValid = false;
    } else {
      setPasswordError("");
    }
    
    return isValid;
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    try {
      setIsLoading(true);
      
      // 保存或清除凭据
      if (rememberMe) {
        localStorage.setItem("rememberMe", "true");
        localStorage.setItem("savedEmail", email);
        localStorage.setItem("savedPassword", password);
      } else {
        localStorage.removeItem("rememberMe");
        localStorage.removeItem("savedEmail");
        localStorage.removeItem("savedPassword");
      }
      
      // 登录 - AuthProvider 将处理导航
      await auth.login(email, password);
      // 不在这里导航，避免和 AuthProvider 中的导航冲突
    } catch (error) {
      console.error("Login error:", error);
    } finally {
      setIsLoading(false);
    }
  };
  
  const toggleShowPassword = () => {
    setShowPassword(!showPassword);
  };
  
  const handleRememberMeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRememberMe(event.target.checked);
  };
  
  const isLight = mode === "light";
  const bgColor = isLight ? "#f5f5f5" : "#212121";
  const isDark = !isLight;
  
  return (
    <BasePage contentStyle={{ backgroundColor: bgColor, padding: 0 }}>
      <Container maxWidth={false} disableGutters sx={{ height: "100vh" }}>
        <Box
          sx={{
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: 2,
          }}
        >
          {/* Logo区域 */}
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              mb: 6,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 2,
              }}
            >
              <SvgIcon
                component={isDark ? iconDark : iconLight}
                style={{
                  height: "48px",
                  width: "48px",
                  marginRight: "10px",
                }}
                inheritViewBox
              />
              <LogoSvg 
                fill={isDark ? "white" : "black"} 
                style={{ 
                  height: "36px", 
                  marginTop: "6px" 
                }}
              />
            </Box>
            <Typography variant="h6" color="textSecondary" gutterBottom>
              {t("Welcome to Proxy Client")}
            </Typography>
          </Box>
          
          <Paper
            elevation={3}
            sx={{
              padding: 4,
              width: "100%",
              maxWidth: 400,
              borderRadius: 2,
            }}
          >
            <Typography variant="h5" align="center" gutterBottom>
              {t("Sign In")}
            </Typography>
            <Typography variant="body2" align="center" color="textSecondary" sx={{ mb: 3 }}>
              {t("Enter your credentials to continue")}
            </Typography>
            
            <form onSubmit={handleSubmit}>
              <TextField
                fullWidth
                margin="normal"
                id="email"
                label={t("Email")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={!!emailError}
                helperText={emailError}
                disabled={isLoading}
                autoComplete="email"
                autoFocus
              />
              
              <TextField
                fullWidth
                margin="normal"
                id="password"
                label={t("Password")}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={!!passwordError}
                helperText={passwordError}
                disabled={isLoading}
                autoComplete="current-password"
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label="toggle password visibility"
                        onClick={toggleShowPassword}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
              />
              
              <FormControlLabel
                control={
                  <Checkbox
                    checked={rememberMe}
                    onChange={handleRememberMeChange}
                    color="primary"
                    disabled={isLoading}
                  />
                }
                label={t("Remember me")}
                sx={{ mt: 1 }}
              />
              
              <Button
                fullWidth
                variant="contained"
                color="primary"
                type="submit"
                disabled={isLoading}
                sx={{ mt: 2, mb: 2, py: 1.2 }}
              >
                {isLoading ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  t("Login")
                )}
              </Button>
            </form>
          </Paper>
          
          {/* 版权信息 */}
          <Typography 
            variant="body2" 
            color="textSecondary" 
            align="center" 
            sx={{ mt: 4 }}
          >
            © {new Date().getFullYear()} Proxy Client
          </Typography>
        </Box>
      </Container>
    </BasePage>
  );
};

export default LoginPage; 