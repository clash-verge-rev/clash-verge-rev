import { initializeClerk } from './clerk';
import { CLERK_CONFIG, validateClerkConfig } from './clerk-config';

export const testClerkSetup = async () => {
  console.log('🧪 测试 Clerk 配置...\n');
  
  // 1. 检查配置
  console.log('📋 配置检查:');
  console.log('- Publishable Key:', CLERK_CONFIG.publishableKey.substring(0, 30) + '...');
  console.log('- Frontend API:', CLERK_CONFIG.frontendApi);
  console.log('- Domain:', CLERK_CONFIG.domain || '未设置');
  
  // 2. 验证配置
  console.log('\n✅ 配置验证:');
  const isValid = validateClerkConfig();
  if (!isValid) {
    console.log('❌ 配置验证失败');
    return false;
  }
  console.log('✅ 配置验证通过');
  
  // 3. 测试初始化
  console.log('\n🚀 初始化测试:');
  try {
    const clerk = await initializeClerk();
    console.log('✅ Clerk 初始化成功');
    console.log('- 版本:', clerk.version || '未知');
    console.log('- 加载状态:', clerk.loaded ? '已加载' : '未加载');
    console.log('- 用户状态:', clerk.user ? '已登录' : '未登录');
    return true;
  } catch (error) {
    console.error('❌ Clerk 初始化失败:', error);
    return false;
  }
};

export const runEnvironmentCheck = () => {
  console.log('🔍 环境变量检查:\n');
  
  const envVars = [
    'VITE_CLERK_PUBLISHABLE_KEY',
    'VITE_CLERK_FRONTEND_API',
    'NODE_ENV'
  ];
  
  envVars.forEach(envVar => {
    const value = process.env[envVar];
    if (value) {
      console.log(`✅ ${envVar}: ${envVar.includes('KEY') ? value.substring(0, 20) + '...' : value}`);
    } else {
      console.log(`❌ ${envVar}: 未设置`);
    }
  });
  
  console.log('\n💡 如果环境变量未设置，请:');
  console.log('1. 检查 .env 文件是否存在');
  console.log('2. 确认环境变量名称正确（使用 VITE_ 前缀）');
  console.log('3. 重启开发服务器');
}; 