package config

import "github.com/metacubex/mihomo/component/age"

func SetGlobalSecretKeys(secretKeys ...string) {
	age.SetGlobalSecretKeys(secretKeys...)
}

func GenX25519KeyPair() (secretKey string, publicKey string, err error) {
	return age.GenX25519KeyPair()
}

func GenHybridKeyPair() (secretKey string, publicKey string, err error) {
	return age.GenHybridKeyPair()
}

func ToPublicKeys(secretKeys ...string) (publicKeys []string, err error) {
	return age.ToPublicKeys(secretKeys...)
}

func VeritySecretKeys(secretKeys ...string) error {
	return age.VeritySecretKeys(secretKeys...)
}

func VerityPublicKeys(publicKeys ...string) error {
	return age.VerityPublicKeys(publicKeys...)
}
