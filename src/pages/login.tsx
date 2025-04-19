import LogoSvg from "@/assets/image/logo.svg?react";
import { useAuth } from "@/providers/auth-provider";
import { useThemeMode } from "@/services/states";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import {
  alpha,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Paper,
  SvgIcon,
  TextField,
  Typography,
  useTheme
} from "@mui/material";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

const LoginPage: React.FC = () => {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const mode = useThemeMode();
  const theme = useTheme();
  
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
  const isDark = !isLight;
  
  return (
    <Box
      sx={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        overflow: "hidden",
        position: "relative",
        bgcolor: "background.default",
      }}
    >
      {/* 左侧装饰区域 */}
      <Box
        sx={{
          width: { xs: 0, md: "45%" },
          height: "100%",
          display: { xs: "none", md: "flex" },
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          overflow: "hidden",
        }}
      >
        {/* 装饰性背景图形 */}
        <Box
          sx={{
            position: "absolute",
            width: "160%",
            height: "160%",
            top: "-30%",
            left: "-30%",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${alpha(theme.palette.primary.light, 0.3)} 0%, transparent 70%)`,
          }}
        />
        <Box
          sx={{
            position: "absolute",
            width: "120%",
            height: "120%",
            bottom: "-20%",
            right: "-20%",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${alpha(theme.palette.primary.dark, 0.3)} 0%, transparent 70%)`,
          }}
        />
        
        {/* 左侧内容 */}
        <Box
          sx={{
            zIndex: 1,
            textAlign: "center",
            p: 5,
            maxWidth: "80%",
          }}
        >
          <Box sx={{ mb: 4 }}>
            <SvgIcon
              component={LogoSvg}
              sx={{
                height: 110,
                width: 110,
                mb: 2,
              }}
              inheritViewBox
            />
            <Typography
              variant="h3"
              component="h1"
              sx={{
                fontWeight: 700,
                mb: 1,
              }}
            >
              101Proxy
            </Typography>
            <Typography variant="h6" sx={{ opacity: 0.8 }}>
              {t("Next-generation proxy client")}
            </Typography>
          </Box>
          
          <Typography 
            variant="body1" 
            sx={{ 
              mt: 4,
              opacity: 0.9,
              fontStyle: "italic"
            }}
          >
            {t("Secure. Fast. Reliable.")}
          </Typography>
        </Box>
        
        {/* 版权信息 */}
        <Typography 
          variant="body2" 
          sx={{ 
            position: "absolute",
            bottom: 16,
            opacity: 0.7,
          }}
        >
          © {new Date().getFullYear()} 101Proxy
        </Typography>
      </Box>
      
      {/* 右侧登录表单区域 */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          p: { xs: 2, sm: 4 },
        }}
      >
        {/* 移动设备上显示的Logo */}
        <Box
          sx={{
            display: { xs: "flex", md: "none" },
            flexDirection: "column",
            alignItems: "center",
            mb: 5,
          }}
        >
          <SvgIcon
            component={LogoSvg}
            sx={{
              height: 70,
              width: 70,
              mb: 1,
            }}
            inheritViewBox
          />
          <Typography variant="h4" sx={{ fontWeight: 600 }}>
            101Proxy
          </Typography>
        </Box>
        
        <Paper
          elevation={6}
          sx={{
            p: { xs: 3, sm: 4 },
            width: "100%",
            maxWidth: 450,
            borderRadius: 2,
            border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            bgcolor: alpha(theme.palette.background.paper, 0.8),
            backdropFilter: "blur(8px)",
          }}
        >
          <Typography 
            variant="h5" 
            align="center" 
            sx={{ 
              mb: 1,
              fontWeight: 600,
            }}
          >
            {t("Welcome Back")}
          </Typography>
          <Typography 
            variant="body2" 
            align="center" 
            color="text.secondary" 
            sx={{ mb: 4 }}
          >
            {t("Sign in to access your dashboard")}
          </Typography>
          
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth
              variant="outlined"
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
              sx={{
                mb: 2,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1.5,
                }
              }}
            />
            
            <TextField
              fullWidth
              variant="outlined"
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
              sx={{
                mb: 1,
                '& .MuiOutlinedInput-root': {
                  borderRadius: 1.5,
                }
              }}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={toggleShowPassword}
                      edge="end"
                      size="large"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
            
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={rememberMe}
                    onChange={handleRememberMeChange}
                    color="primary"
                    disabled={isLoading}
                    size="small"
                  />
                }
                label={<Typography variant="body2">{t("Remember me")}</Typography>}
              />
            </Box>
            
            <Button
              fullWidth
              variant="contained"
              color="primary"
              type="submit"
              disabled={isLoading}
              sx={{ 
                mt: 1, 
                py: 1.5,
                borderRadius: 1.5,
                fontWeight: 600,
                boxShadow: 2,
              }}
            >
              {isLoading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                t("Sign In")
              )}
            </Button>
          </form>
        </Paper>
        
        {/* 移动设备上的版权信息 */}
        <Typography 
          variant="body2" 
          color="text.secondary" 
          align="center" 
          sx={{ 
            mt: 4,
            display: { xs: "block", md: "none" }
          }}
        >
          © {new Date().getFullYear()} 101Proxy
        </Typography>
      </Box>
    </Box>
  );
};

export default LoginPage; 