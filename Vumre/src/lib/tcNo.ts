/** TC Kimlik No algoritma kontrolü (11 hane, ilk hane 0 olamaz, 10. ve 11. hane sağlaması). */
export function isValidTcNo(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false
  const d = value.split('').map(Number)
  const odd = d[0]! + d[2]! + d[4]! + d[6]! + d[8]!
  const even = d[1]! + d[3]! + d[5]! + d[7]!
  const d10 = (((odd * 7 - even) % 10) + 10) % 10
  const d11 = d.slice(0, 10).reduce((sum, n) => sum + n, 0) % 10
  return d[9] === d10 && d[10] === d11
}
