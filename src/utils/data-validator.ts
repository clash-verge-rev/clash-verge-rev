/**
 * 类型安全的数据验证器
 * 确保从后端接收的数据符合预期的接口定义
 */

// 数字验证器
function isValidNumber(value: any): value is number {
  return typeof value === "number" && !isNaN(value) && isFinite(value);
}

// 字符串验证器
function isValidString(value: any): value is string {
  return typeof value === "string" && value.length > 0;
}

// 布尔值验证器
function isValidBoolean(value: any): value is boolean {
  return typeof value === "boolean";
}

/**
 * 系统监控数据验证器
 */
export class SystemMonitorValidator implements ISystemMonitorOverviewValidator {
  /**
   * 验证数据是否符合ISystemMonitorOverview接口
   */
  validate(data: any): data is ISystemMonitorOverview {
    if (!data || typeof data !== "object") {
      console.warn("[DataValidator] 数据不是对象:", data);
      return false;
    }

    // 验证traffic字段
    if (!this.validateTrafficData(data.traffic)) {
      console.warn("[DataValidator] traffic字段验证失败:", data.traffic);
      return false;
    }

    // 验证memory字段
    if (!this.validateMemoryData(data.memory)) {
      console.warn("[DataValidator] memory字段验证失败:", data.memory);
      return false;
    }

    // 验证overall_status字段
    if (!this.validateOverallStatus(data.overall_status)) {
      console.warn(
        "[DataValidator] overall_status字段验证失败:",
        data.overall_status,
      );
      return false;
    }

    return true;
  }

  /**
   * 清理和修复数据，确保返回有效的ISystemMonitorOverview
   */
  sanitize(data: any): ISystemMonitorOverview {
    // debugLog("[DataValidator] 开始数据清理:", data);

    const sanitized: ISystemMonitorOverview = {
      traffic: this.sanitizeTrafficData(data?.traffic),
      memory: this.sanitizeMemoryData(data?.memory),
      overall_status: this.sanitizeOverallStatus(data?.overall_status),
    };

    // debugLog("[DataValidator] 数据清理完成:", sanitized);
    return sanitized;
  }

  private validateTrafficData(traffic: any): boolean {
    if (!traffic || typeof traffic !== "object") return false;

    // 验证raw字段
    const raw = traffic.raw;
    if (!raw || typeof raw !== "object") return false;
    if (
      !isValidNumber(raw.up) ||
      !isValidNumber(raw.down) ||
      !isValidNumber(raw.up_rate) ||
      !isValidNumber(raw.down_rate)
    ) {
      return false;
    }

    // 验证formatted字段
    const formatted = traffic.formatted;
    if (!formatted || typeof formatted !== "object") return false;
    if (
      !isValidString(formatted.up_rate) ||
      !isValidString(formatted.down_rate) ||
      !isValidString(formatted.total_up) ||
      !isValidString(formatted.total_down)
    ) {
      return false;
    }

    // 验证is_fresh字段
    if (!isValidBoolean(traffic.is_fresh)) return false;

    return true;
  }

  private validateMemoryData(memory: any): boolean {
    if (!memory || typeof memory !== "object") return false;

    // 验证raw字段
    const raw = memory.raw;
    if (!raw || typeof raw !== "object") return false;
    if (
      !isValidNumber(raw.inuse) ||
      !isValidNumber(raw.oslimit) ||
      !isValidNumber(raw.usage_percent)
    ) {
      return false;
    }

    // 验证formatted字段
    const formatted = memory.formatted;
    if (!formatted || typeof formatted !== "object") return false;
    if (
      !isValidString(formatted.inuse) ||
      !isValidString(formatted.oslimit) ||
      !isValidNumber(formatted.usage_percent)
    ) {
      return false;
    }

    // 验证is_fresh字段
    if (!isValidBoolean(memory.is_fresh)) return false;

    return true;
  }

  private validateOverallStatus(status: any): boolean {
    return (
      typeof status === "string" &&
      ["active", "inactive", "error", "unknown", "healthy"].includes(status)
    );
  }

  private sanitizeTrafficData(traffic: any) {
    const raw = traffic?.raw || {};
    const formatted = traffic?.formatted || {};

    return {
      raw: {
        up: isValidNumber(raw.up) ? raw.up : 0,
        down: isValidNumber(raw.down) ? raw.down : 0,
        up_rate: isValidNumber(raw.up_rate) ? raw.up_rate : 0,
        down_rate: isValidNumber(raw.down_rate) ? raw.down_rate : 0,
      },
      formatted: {
        up_rate: isValidString(formatted.up_rate) ? formatted.up_rate : "0B",
        down_rate: isValidString(formatted.down_rate)
          ? formatted.down_rate
          : "0B",
        total_up: isValidString(formatted.total_up) ? formatted.total_up : "0B",
        total_down: isValidString(formatted.total_down)
          ? formatted.total_down
          : "0B",
      },
      is_fresh: isValidBoolean(traffic?.is_fresh) ? traffic.is_fresh : false,
    };
  }

  private sanitizeMemoryData(memory: any) {
    const raw = memory?.raw || {};
    const formatted = memory?.formatted || {};

    return {
      raw: {
        inuse: isValidNumber(raw.inuse) ? raw.inuse : 0,
        oslimit: isValidNumber(raw.oslimit) ? raw.oslimit : 0,
        usage_percent: isValidNumber(raw.usage_percent) ? raw.usage_percent : 0,
      },
      formatted: {
        inuse: isValidString(formatted.inuse) ? formatted.inuse : "0B",
        oslimit: isValidString(formatted.oslimit) ? formatted.oslimit : "0B",
        usage_percent: isValidNumber(formatted.usage_percent)
          ? formatted.usage_percent
          : 0,
      },
      is_fresh: isValidBoolean(memory?.is_fresh) ? memory.is_fresh : false,
    };
  }

  private sanitizeOverallStatus(
    status: any,
  ): "active" | "inactive" | "error" | "unknown" | "healthy" {
    if (
      typeof status === "string" &&
      ["active", "inactive", "error", "unknown", "healthy"].includes(status)
    ) {
      return status as "active" | "inactive" | "error" | "unknown" | "healthy";
    }
    return "unknown";
  }
}

// 全局验证器实例
export const systemMonitorValidator = new SystemMonitorValidator();

/**
 * 安全的API调用包装器
 */
export function withDataValidation<T extends (...args: any[]) => Promise<any>>(
  apiCall: T,
  validator: { validate: (data: any) => boolean; sanitize: (data: any) => any },
): T {
  return (async (...args: Parameters<T>) => {
    try {
      const result = await apiCall(...args);

      if (validator.validate(result)) {
        return result;
      } else {
        console.warn("[DataValidator] API返回数据验证失败，尝试修复:", result);
        return validator.sanitize(result);
      }
    } catch (error) {
      console.error("[DataValidator] API调用失败:", error);
      // 返回安全的默认值
      return validator.sanitize(null);
    }
  }) as T;
}
