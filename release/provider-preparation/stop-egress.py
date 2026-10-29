import subprocess
r=subprocess.run(['docker','inspect','--format','{{index .Config.Labels "getoyi.isolated.provider"}}','hardware-provider-egress'],capture_output=True,text=True)
if r.stdout.strip()=='true':subprocess.run(['docker','rm','-f','hardware-provider-egress'],check=True,capture_output=True)
subprocess.run(['docker','network','rm','hardware-provider-egress-nat'],capture_output=True)
print('Only dedicated preparation relay/network removed')
