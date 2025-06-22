// 代理配置服务
// 使用现有的 importProfile 功能从 101proxy 获取节点信息

import { importProfile } from "@/services/cmds";

// 101Proxy 节点配置 URL
const PROXY_CONFIG_URL = 'http://13.230.16.216/api/short_url/k3pia-';

export interface ProxyImportResult {
  success: boolean;
  message: string;
  url: string;
}

/**
 * 导入 101Proxy 节点配置
 * 使用现有的 importProfile 功能
 */
export const importProxyNodes = async (): Promise<ProxyImportResult> => {
  try {
    console.log('📡 正在导入 101Proxy 节点配置...');
    console.log('🔗 配置URL:', PROXY_CONFIG_URL);
    
    // 使用现有的 importProfile 功能
    await importProfile(PROXY_CONFIG_URL, { 
      with_proxy: true 
    });
    
    console.log('✅ 成功导入 101Proxy 节点配置');
    
    return {
      success: true,
      message: '成功导入 101Proxy 节点配置',
      url: PROXY_CONFIG_URL
    };
    
  } catch (error) {
    console.error('❌ 导入节点配置失败:', error);
    
    const errorMessage = error instanceof Error ? error.message : '未知错误';
    
    return {
      success: false,
      message: `导入节点配置失败: ${errorMessage}`,
      url: PROXY_CONFIG_URL
    };
  }
};

/**
 * 更新代理配置的完整流程
 * 包括导入配置和错误处理
 */
export const updateProxyConfiguration = async (): Promise<ProxyImportResult> => {
  try {
    console.log('🚀 开始更新代理配置...');
    
    const result = await importProxyNodes();
    
    if (result.success) {
      console.log('🎉 代理配置更新完成！');
    } else {
      console.error('❌ 代理配置更新失败:', result.message);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ 更新代理配置失败:', error);
    
    return {
      success: false,
      message: `更新代理配置失败: ${error instanceof Error ? error.message : '未知错误'}`,
      url: PROXY_CONFIG_URL
    };
  }
}; 