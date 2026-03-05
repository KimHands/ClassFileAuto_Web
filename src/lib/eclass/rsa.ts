/**
 * Python auth.py의 _build_encrypted_pw()를 TypeScript로 포팅.
 *
 * JS 원본 (SSO formSubmit):
 *   var jsonObj = { userid: 'H학번', userpw: '비밀번호', ssoChallenge: '...' }
 *   pw = rsa.encrypt(JSON.stringify(jsonObj))   // PKCS1v15
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const forge = require('node-forge')

export function buildEncryptedPw(
  studentId: string,
  password: string,
  ssoChallenge: string,
  modulusHex: string,
  exponentHex: string,
): string {
  const jsonPayload = JSON.stringify({
    userid: `H${studentId}`,
    userpw: password,
    ssoChallenge,
  })

  // Python: RSAPublicNumbers(e=exponent, n=modulus)
  const n = new forge.jsbn.BigInteger(modulusHex, 16)
  const e = new forge.jsbn.BigInteger(exponentHex, 16)
  const publicKey = forge.pki.rsa.setPublicKey(n, e)

  // PKCS1v15 암호화 → hex 변환 (Python: encrypted.hex())
  const encrypted: string = publicKey.encrypt(jsonPayload, 'RSAES-PKCS1-V1_5')
  return forge.util.bytesToHex(encrypted)
}
