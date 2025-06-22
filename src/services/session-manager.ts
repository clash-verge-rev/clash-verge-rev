// 会话管理工具
// 处理 Clerk 会话状态和重复登录问题

import { getClerk, getCurrentUser, isUserSignedIn } from './clerk';

export interface SessionInfo {
  isSignedIn: boolean;
  user: any | null;
  sessionId: string | null;
}

/**
 * 获取当前会话信息
 */
export const getCurrentSession = async (): Promise<SessionInfo> => {
  try {
    const clerk = getClerk();
    const user = getCurrentUser();
    const isSignedIn = isUserSignedIn();
    
    return {
      isSignedIn,
      user,
      sessionId: clerk?.session?.id || null
    };
  } catch (error) {
    console.error('获取会话信息失败:', error);
    return {
      isSignedIn: false,
      user: null,
      sessionId: null
    };
  }
};

/**
 * 清理无效会话
 */
export const clearInvalidSession = async (): Promise<void> => {
  try {
    const clerk = getClerk();
    if (!clerk) return;
    
    // 如果存在无效会话，尝试清理
    if (clerk.session && !clerk.user) {
      console.log('检测到无效会话，正在清理...');
      await clerk.signOut();
    }
  } catch (error) {
    console.error('清理会话失败:', error);
  }
};

/**
 * 检查会话状态并处理重复登录
 */
export const handleSessionConflict = async (): Promise<'signed_in' | 'signed_out' | 'error'> => {
  try {
    const session = await getCurrentSession();
    
    if (session.isSignedIn && session.user) {
      console.log('用户已登录:', session.user.primaryEmailAddress?.emailAddress);
      return 'signed_in';
    }
    
    // 清理可能的无效会话
    await clearInvalidSession();
    return 'signed_out';
    
  } catch (error) {
    console.error('处理会话冲突失败:', error);
    return 'error';
  }
};

/**
 * 安全登录 - 检查现有会话
 */
export const safeSignIn = async (signInFunction: () => Promise<any>): Promise<any> => {
  try {
    // 首先检查会话状态
    const sessionStatus = await handleSessionConflict();
    
    if (sessionStatus === 'signed_in') {
      throw new Error('用户已登录');
    }
    
    // 执行登录
    return await signInFunction();
    
  } catch (error) {
    console.error('安全登录失败:', error);
    
    // 如果是会话冲突错误，返回特殊标识
    if (error instanceof Error && 
        (error.message.includes('session_exists') || 
         error.message.includes('already signed in') ||
         error.message.includes('用户已登录'))) {
      throw new Error('SESSION_EXISTS');
    }
    
    throw error;
  }
}; 