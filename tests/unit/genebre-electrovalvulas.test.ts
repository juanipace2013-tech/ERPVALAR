import { describe, it, expect } from 'vitest'
import { getBobinasElectrovalvula } from '@/lib/genebre-electrovalvulas'

describe('getBobinasElectrovalvula', () => {
  it('vapor 4427/4428: bobina 4816 de 16W en 4 tensiones, con conector', () => {
    for (const sku of ['4427 04', '4428 09']) {
      expect(getBobinasElectrovalvula(sku)).toEqual([
        { tension: '220V AC', bobinaSku: '4816 220', conectorSku: '4801 08' },
        { tension: '110V AC', bobinaSku: '4816 110', conectorSku: '4801 08' },
        { tension: '24V AC', bobinaSku: '4816 24', conectorSku: '4801 08' },
        { tension: '24V DC', bobinaSku: '4816 C24', conectorSku: '4801 08' },
      ])
    }
  })

  it('las series de siempre no cambian', () => {
    expect(getBobinasElectrovalvula('4020 05').map((k) => k.bobinaSku)).toEqual(['4808 22', '4808 11', '4808 24', '4808 C12', '4808 C24'])
    expect(getBobinasElectrovalvula('4010 06').map((k) => k.bobinaSku)).toEqual(['4814 22', '4814 11', '4814 24', '4814 C12', '4814 C24'])
    expect(getBobinasElectrovalvula('4427 04 220V')).toEqual([])
  })
})
