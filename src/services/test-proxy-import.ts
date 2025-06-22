// 测试代理导入功能
import { updateProxyConfiguration } from './proxy-config';

export const testProxyImport = async () => {
  console.log('🧪 测试代理节点导入功能...\n');
  
  try {
    const result = await updateProxyConfiguration();
    
    if (result.success) {
      console.log('✅ 测试成功!');
      console.log('📋 导入结果:', result.message);
      console.log('🔗 配置来源:', result.url);
    } else {
      console.log('❌ 测试失败!');
      console.log('📋 错误信息:', result.message);
    }
    
    return result;
  } catch (error) {
    console.error('❌ 测试异常:', error);
    return {
      success: false,
      message: `测试异常: ${error instanceof Error ? error.message : '未知错误'}`,
      url: ''
    };
  }
};

// 导出便于在开发者控制台调用
if (typeof window !== 'undefined') {
  (window as any).testProxyImport = testProxyImport;
} 