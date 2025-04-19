use windows::core::BSTR;
use windows::Win32::Foundation::{VARIANT_BOOL, VARIANT_TRUE};
use windows::Win32::NetworkManagement::WindowsFirewall::{
    INetFwPolicy2, INetFwRule, NetFwPolicy2, NetFwRule, NET_FW_ACTION_ALLOW,
    NET_FW_PROFILE2_PRIVATE,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 初始化 COM 库
    unsafe {
        // 规则名称， aa 主要用于在查看防火墙规则时，在最前面显示 （仅用于测试）
        let rule_name = "aa-verge-mihomo".to_string();
        let _ = windows::Win32::System::Com::CoInitializeEx(
            None,
            windows::Win32::System::Com::COINIT_MULTITHREADED,
        );
        let mut fw_policy: windows::core::Result<INetFwPolicy2> =
            CoCreateInstance(&NetFwPolicy2, None, CLSCTX_INPROC_SERVER);
        let fw_policy = fw_policy.as_mut().unwrap();

        let enabled = fw_policy
            .get_FirewallEnabled(NET_FW_PROFILE2_PRIVATE)
            .unwrap();
        println!("Firewall enabled: {}", enabled == VARIANT_TRUE);

        let rules = fw_policy.Rules().unwrap();
        println!("There are {} rules", rules.Count().unwrap_or(0));

        if let Ok(rule) = rules.Item(&BSTR::from(&rule_name)) {
            // code to do when rule found
            println!("The rule '{}' exists !!!", rule_name);
            rules
                .Remove(&BSTR::from(&rule_name))
                .expect(format!("Failed to remove rule '{}'", rule_name).as_str());
            println!("Rule '{}' has been removed", rule.Name().unwrap());
        } else {
            // firewall rule not found, create a new one
            println!("The rule '{}' doesn't exist", rule_name);
            let rule: INetFwRule =
                CoCreateInstance(&NetFwRule, None, CLSCTX_INPROC_SERVER).unwrap();
            // set the properties of the new rule
            rule.SetName(&BSTR::from(&rule_name))?;
            rule.SetDescription(&BSTR::from("allow verge-mihomo"))?;
            rule.SetApplicationName(&BSTR::from("D:\\Clash Verge\\verge-mihomo.exe"))?;
            rule.SetAction(NET_FW_ACTION_ALLOW)?;
            rule.SetEnabled(VARIANT_BOOL::from(true))?;

            rules.Add(&rule).expect("Couldn't add rule");
            println!(
                "Rule '{:?}' was added to the firewall",
                rule.Name().unwrap()
            );
        }
    }
    Ok(())
}
