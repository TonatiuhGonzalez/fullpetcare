import { describe, expect, it } from 'vitest'

import {
  barPercents,
  centsToPesosText,
  csvCell,
  daysInRange,
  formatDayLabel,
  periodRange,
  rangeProblem,
  toCsv,
} from './reports'

describe('periodRange', () => {
  it('hoy es solo hoy', () => {
    expect(periodRange('today', '2026-10-07')).toEqual({
      from: '2026-10-07',
      to: '2026-10-07',
    })
  })

  it('la semana empieza en lunes: un miércoles va del lunes a hoy', () => {
    // 2026-10-07 es miércoles. Si empezara en domingo, el reporte incluiría un
    // día de la semana anterior.
    expect(periodRange('week', '2026-10-07')).toEqual({
      from: '2026-10-05',
      to: '2026-10-07',
    })
  })

  it('un lunes la semana es solo ese día, y un domingo abarca los seis días anteriores', () => {
    expect(periodRange('week', '2026-10-05')).toEqual({
      from: '2026-10-05',
      to: '2026-10-05',
    })
    expect(periodRange('week', '2026-10-11')).toEqual({
      from: '2026-10-05',
      to: '2026-10-11',
    })
  })

  it('la semana puede cruzar de mes y de año', () => {
    // Jueves 1 de enero de 2026: el lunes fue el 29 de diciembre de 2025.
    expect(periodRange('week', '2026-01-01')).toEqual({
      from: '2025-12-29',
      to: '2026-01-01',
    })
  })

  it('el mes va del día 1 a hoy', () => {
    expect(periodRange('month', '2026-10-07')).toEqual({
      from: '2026-10-01',
      to: '2026-10-07',
    })
  })

  it('el mes pasado es completo, también en enero y en febrero bisiesto', () => {
    // Si el cálculo restara 30 días, febrero y los meses de 31 días saldrían mal.
    expect(periodRange('last_month', '2026-10-07')).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(periodRange('last_month', '2026-01-15')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    })
    expect(periodRange('last_month', '2028-03-10')).toEqual({
      from: '2028-02-01',
      to: '2028-02-29',
    })
    expect(periodRange('last_month', '2026-03-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('rangeProblem y daysInRange', () => {
  it('cuenta ambos extremos', () => {
    expect(daysInRange({ from: '2026-10-01', to: '2026-10-01' })).toBe(1)
    expect(daysInRange({ from: '2026-10-01', to: '2026-10-31' })).toBe(31)
  })

  it('acepta un rango válido y explica los inválidos', () => {
    expect(rangeProblem({ from: '2026-10-01', to: '2026-10-31' })).toBeNull()
    expect(rangeProblem({ from: '', to: '2026-10-31' })).toMatch(/dos fechas/)
    expect(rangeProblem({ from: '2026-10-31', to: '2026-10-01' })).toMatch(/posterior/)
  })

  it('el tope es de 366 días, igual que la base', () => {
    // Si la pantalla dejara más, la base responde con un error poco claro.
    expect(rangeProblem({ from: '2025-10-07', to: '2026-10-07' })).toBeNull() // 366 días
    expect(rangeProblem({ from: '2025-10-06', to: '2026-10-07' })).toMatch(
      /mayor a un año/,
    ) // 367
  })
})

describe('barPercents', () => {
  it('escala respecto al mayor', () => {
    expect(barPercents([100, 50, 0])).toEqual([100, 50, 0])
  })

  it('un valor pequeño pero mayor a cero no se dibuja en cero', () => {
    // Una barra invisible parecería "ese día no se vendió nada".
    expect(barPercents([100000, 1])).toEqual([100, 2])
  })

  it('si todo es cero, todas miden cero (sin dividir entre cero)', () => {
    expect(barPercents([0, 0, 0])).toEqual([0, 0, 0])
    expect(barPercents([])).toEqual([])
  })
})

describe('centsToPesosText', () => {
  it('da pesos con dos decimales, sin signo de pesos ni comas', () => {
    // Así Excel lo reconoce como número y lo puede sumar.
    expect(centsToPesosText(35000)).toBe('350.00')
    expect(centsToPesosText(5)).toBe('0.05')
    expect(centsToPesosText(123456789)).toBe('1234567.89')
    expect(centsToPesosText(0)).toBe('0.00')
  })

  it('conserva el signo de un monto negativo', () => {
    expect(centsToPesosText(-1050)).toBe('-10.50')
    expect(centsToPesosText(-5)).toBe('-0.05')
  })
})

describe('csvCell', () => {
  it('entrecomilla comas, comillas y saltos de línea', () => {
    expect(csvCell('Baño, corte y secado')).toBe('"Baño, corte y secado"')
    expect(csvCell('El "mejor" shampoo')).toBe('"El ""mejor"" shampoo"')
    expect(csvCell('línea 1\nlínea 2')).toBe('"línea 1\nlínea 2"')
  })

  it('neutraliza las fórmulas en texto, pero deja pasar los números negativos', () => {
    // El nombre de un producto lo escribe una persona: "=HYPERLINK(...)" se
    // ejecutaría al abrir el archivo en Excel.
    expect(csvCell('=CMD("calc")')).toBe(`"'=CMD(""calc"")"`)
    expect(csvCell('+52 999')).toBe("'+52 999")
    expect(csvCell('@usuario')).toBe("'@usuario")
    expect(csvCell(-5)).toBe('-5')
  })

  it('un texto normal no cambia', () => {
    expect(csvCell('Alimento seco 3 kg')).toBe('Alimento seco 3 kg')
  })
})

describe('toCsv', () => {
  const rows = [
    { name: 'Baño', cents: 25000 },
    { name: 'Shampoo, 250 ml', cents: 14500 },
  ]
  const columns = [
    { header: 'Concepto', value: (r: (typeof rows)[number]) => r.name },
    { header: 'Importe', value: (r: (typeof rows)[number]) => centsToPesosText(r.cents) },
  ]

  it('empieza con BOM para que Excel lea los acentos, y usa CRLF', () => {
    // Sin el BOM, "Baño" se vería "BaÃ±o" al abrirlo en Excel.
    const csv = toCsv(rows, columns)
    expect(csv.startsWith('﻿Concepto,Importe\r\n')).toBe(true)
    expect(csv).toBe('﻿Concepto,Importe\r\nBaño,250.00\r\n"Shampoo, 250 ml",145.00\r\n')
  })

  it('sin filas deja solo el encabezado', () => {
    expect(toCsv([], columns)).toBe('﻿Concepto,Importe\r\n')
  })
})

describe('formatDayLabel', () => {
  it('muestra el día de calendario sin correrse por la zona horaria del navegador', () => {
    // 'YYYY-MM-DD' es un día, no un instante: en un navegador de UTC−6 un
    // parseo ingenuo mostraría el día anterior.
    expect(formatDayLabel('2026-10-05')).toMatch(/^5 oct/)
    expect(formatDayLabel('2026-10-05', true)).toBe('5 de octubre de 2026')
    expect(formatDayLabel('2026-01-01')).toMatch(/^1 ene/)
  })
})
