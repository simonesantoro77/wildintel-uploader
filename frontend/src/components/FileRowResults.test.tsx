import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import FileRowResults, { type FileRow } from './FileRowResults'

const rows: FileRow[] = [
  { row: 2, site: 'WICP_0001', session: 'R0001', actions: 'Revision + Desinstallation', date: '2026-09-14', time: '11:40', result: 'already_kept', label: 'Already kept', message: 'The R0001 visit of WICP_0001 is already kept.' },
  { row: 3, site: 'WICP_0002', result: 'problem', label: 'Actions not valid', message: "The actions 'Flying' are not valid." },
  { row: 4, site: 'WICP_0003', result: 'ok', label: '', message: '', data: { location_id: 'WICP_0003', actions: 'Installation', camera_model: 'Browning' } },
  { row: 5, site: 'WICP_0004', session: 'R0001', date: '2026-09-10', time: '09:00', result: 'already_kept', label: 'Already kept', message: 'The R0001 visit of WICP_0004 is already kept.' },
]

describe('FileRowResults', () => {
  it('counts the rows and shows them one by one, the first with an error open, and keeps the ones of the figure that is pressed', async () => {
    render(<FileRowResults rows={rows} />)
    const card = (title: string) => screen.getByRole('button', { name: title })
    expect(card('Rows read')).toHaveTextContent('Rows read4Every row of the file')
    expect(card('New visits')).toHaveTextContent('New visits1Will be added')
    expect(card('Already in the app')).toHaveTextContent('Already in the app2Not loaded again')
    expect(card('With problems')).toHaveTextContent('With problems1Not added until fixed')
    const table = screen.getByRole('table', { name: 'Rows of the file' })
    const line = (n: number) => within(table).getByRole('button', { name: `View the contents of Row ${n}` }).closest('tr')!
    expect(line(4)).toHaveTextContent('4—WICP_0003——New visit')
    expect(line(3)).toHaveTextContent('3—WICP_0002——Error')                  // an error says only that: which one is told by its errors
    expect(line(2)).toHaveTextContent('2R0001WICP_0001Revision + Desinstallation14 Sep 2026, 11:40Already in the app')   // the row, the revision, the location and what became of it
    expect(within(table).queryByText('Diagnosis')).not.toBeInTheDocument()

    // the figures are the filters: the one pressed keeps its rows, and pressed again lets them all be seen
    await userEvent.click(card('With problems'))
    expect(card('With problems')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: 'View the contents of Row 4' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'View the contents of Row 2' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^(Show|Hide) the errors of Row 3$/ }))
    expect(screen.getByRole('table', { name: 'Problems of Row 3' })).toHaveTextContent("The actions 'Flying' are not valid.")
  })

  it('has an eye in every row that opens a panel at the right with what the row says — and what is wrong with it, when something is', async () => {
    render(<FileRowResults rows={rows} labels={{ camera_model: 'Camera model' }} />)
    expect(screen.queryByRole('button', { name: /^(Show|Hide) the errors of Row 4$/ })).not.toBeInTheDocument()     // a row to add has no errors
    expect(screen.getByRole('button', { name: /^(Show|Hide) the errors of Row 2$/ })).toHaveAttribute('aria-expanded', 'true')   // the first row with errors starts open

    await userEvent.click(screen.getByRole('button', { name: 'View the contents of Row 4' }))
    const panel = screen.getByRole('dialog', { name: 'Details of row 4' })
    const contents = within(panel).getByLabelText('Contents of row 4')
    expect(within(contents).getByText('Camera model').closest('div')).toHaveTextContent('Camera modelBrowning')   // named as the field is, or by its key
    expect(within(contents).getByText('actions').closest('div')).toHaveTextContent('actionsInstallation')

    await userEvent.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'View the contents of Row 2' }))       // a row with errors says them in the panel too
    expect(within(screen.getByRole('dialog', { name: 'Details of row 2' })).getByRole('region', { name: 'Problems of row 2' })).toBeInTheDocument()
  })

  it('has a chevron only in the rows with something wrong, to see the error under the row, and marks a row while its details are open or its panel is', async () => {
    render(<FileRowResults rows={rows} />)
    expect(screen.queryByRole('button', { name: /^(Show|Hide) the (contents|errors) of Row 4$/ })).not.toBeInTheDocument()    // a row that is fine has no chevron: its eye says what it says
    const fine = screen.getByRole('button', { name: 'View the contents of Row 4' }).closest('tr')!.querySelector('td')!
    expect(fine).toHaveClass('border-l-transparent')
    await userEvent.click(screen.getByRole('button', { name: 'View the contents of Row 4' }))
    expect(fine).toHaveClass('border-l-blue-500')                                                // marked while its panel is open
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    expect(fine).toHaveClass('border-l-transparent')

    const chevron = screen.getByRole('button', { name: /^(Show|Hide) the errors of Row 3$/ })     // a row with errors
    await userEvent.click(chevron)
    expect(screen.getByRole('table', { name: 'Problems of Row 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide the errors of Row 3' })).toHaveAttribute('aria-expanded', 'true')
    expect(chevron.closest('td')).toHaveClass('border-l-blue-500')                               // the open row is marked
  })

  it('searches the rows by what they say: the words typed have to be all in the row', async () => {
    render(<FileRowResults rows={rows} />)
    const seen = () => within(screen.getByRole('table', { name: 'Rows of the file' })).getAllByRole('button', { name: /^View the contents of Row/ }).map((b) => b.getAttribute('aria-label')!.replace(/^.* Row /, ''))
    expect(seen()).toEqual(['2', '3', '4', '5'])

    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), 'wicp_0001')
    expect(seen()).toEqual(['2'])
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search the rows' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), 'r0001 already')                 // the visit and what became of it
    expect(seen()).toEqual(['2', '5'])
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search the rows' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), 'flying')                       // what is wrong with it
    expect(seen()).toEqual(['3'])

    // together with the filter of the figure that is pressed
    await userEvent.clear(screen.getByRole('textbox', { name: 'Search the rows' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), 'wicp')
    await userEvent.click(screen.getByRole('button', { name: 'Already in the app' }))
    expect(seen()).toEqual(['2', '5'])
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), 'zzz')
    expect(screen.getByText(/No row matches/)).toBeInTheDocument()
  })

  it('goes ten rows at a time, and starts again from the first page when the search or the filter changes', async () => {
    const many: FileRow[] = Array.from({ length: 25 }, (_, i) => ({ row: i + 2, site: `WICP_${String(i + 1).padStart(4, '0')}`, session: 'R0001', actions: 'Installation', result: 'ok' as const, label: '', message: '' }))
    render(<FileRowResults rows={many} />)
    const seen = () => within(screen.getByRole('table', { name: 'Rows of the file' })).getAllByRole('button', { name: /^View the contents of Row/ }).map((b) => b.getAttribute('aria-label')!.replace(/^.* Row /, ''))
    expect(seen()).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10', '11'])
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Showing 1–10 of 25 rows')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(seen()[0]).toBe('12')
    await userEvent.click(screen.getByRole('button', { name: 'Page 3' }))
    expect(seen()).toEqual(['22', '23', '24', '25', '26'])
    expect(screen.getByText(/Showing 21–25 of 25 rows/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

    // what is shown changes: back to the first page
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), 'wicp_001')
    expect(screen.getByText(/Showing 1–10 of 10 rows/)).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Pages' })).not.toBeInTheDocument()      // one page: nothing to turn
  })

  it('tells what is odd in a row that is added, in that row: an amber pill and its own errors', async () => {
    const odd: FileRow[] = [
      { row: 2, site: 'WICP_0001', session: 'R0002', result: 'ok', label: '', message: '', warnings: ['R0002 WICP_0001: SD card 1 was collected at WICP_0002 in this revision (R0002).', 'R0002: card 1 is at 2 sites (WICP_0001, WICP_0002).'] },
      { row: 3, site: 'WICP_0002', session: 'R0002', result: 'ok', label: '', message: '' },
    ]
    render(<FileRowResults rows={odd} />)
    const table = screen.getByRole('table', { name: 'Rows of the file' })
    expect(within(table).getByRole('button', { name: 'View the contents of Row 2' }).closest('tr')).toHaveTextContent('New visit · to check')
    expect(within(table).getByRole('button', { name: 'View the contents of Row 3' }).closest('tr')).not.toHaveTextContent('to check')
    expect(screen.queryByRole('button', { name: /^(Show|Hide) the errors of Row 3$/ })).not.toBeInTheDocument()     // nothing odd in it

    // it starts open, with each thing to check
    const problems = screen.getByRole('table', { name: 'Problems of Row 2' })
    expect(within(problems).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual([
      'To checkR0002 WICP_0001: SD card 1 was collected at WICP_0002 in this revision (R0002).', 'To checkR0002: card 1 is at 2 sites (WICP_0001, WICP_0002).',
    ])
    // it is still a row to add: counted as ready, and found by what is odd in it
    expect(screen.getByRole('button', { name: 'New visits' })).toHaveTextContent('2')
    await userEvent.type(screen.getByRole('textbox', { name: 'Search the rows' }), '2 sites')
    expect(within(screen.getByRole('table', { name: 'Rows of the file' })).getAllByRole('button', { name: /^View the contents of Row/ })).toHaveLength(1)

    // and told by its error: To check
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Group by' }), 'error')
    expect(within(screen.getByRole('table', { name: 'Errors of the file' })).getByText('To check').closest('tr')).toHaveTextContent('1 row')
  })

  it('sorts the rows by a column, and turns the order round when it is pressed again', async () => {
    render(<FileRowResults rows={rows} />)
    const order = () => within(screen.getByRole('table', { name: 'Rows of the file' })).getAllByRole('button', { name: /^View the contents of Row/ }).map((b) => b.getAttribute('aria-label')!.replace(/^.* Row /, ''))
    expect(order()).toEqual(['2', '3', '4', '5'])
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Row' }))
    expect(order()).toEqual(['5', '4', '3', '2'])
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Location ID' }))
    expect(order()).toEqual(['2', '3', '4', '5'])
    await userEvent.click(screen.getByRole('button', { name: 'Sort by When' }))
    expect(order()).toEqual(['3', '4', '5', '2'])   // the rows with no date first, then the oldest day
    await userEvent.click(screen.getByRole('button', { name: 'Sort by Status' }))
    expect(order()).toEqual(['2', '5', '3', '4'])   // by what the pill says: Already in the app ×2, Error, New visit
  })

  it('groups the rows by error, and shows the rows of the one that is picked', async () => {
    render(<FileRowResults rows={rows} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Group by' }), 'error')
    const errors = screen.getByRole('table', { name: 'Errors of the file' })
    expect(within(errors).getByText('Already kept').closest('tr')).toHaveTextContent('2 rows')
    expect(screen.queryByRole('table', { name: /^Rows with/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show the rows with Already kept' }))
    const picked = screen.getByRole('table', { name: 'Rows with Already kept' })
    expect(within(picked).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual([
      '2R0001WICP_0001The R0001 visit of WICP_0001 is already kept.', '5R0001WICP_0004The R0001 visit of WICP_0004 is already kept.',
    ])
    // the filter applies to this view too
    await userEvent.click(screen.getByRole('button', { name: 'With problems' }))
    expect(screen.queryByRole('button', { name: 'Show the rows with Already kept' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show the rows with Actions not valid' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'With problems' }))   // pressed again: all the rows
    await userEvent.click(screen.getByRole('button', { name: 'Hide the rows with Already kept' }))
    expect(screen.queryByRole('table', { name: 'Rows with Already kept' })).not.toBeInTheDocument()
  })

  it('has a square for each of the latest revisions of the file and a list for the older ones, and picking one keeps its rows', async () => {
    const many: FileRow[] = Array.from({ length: 8 }, (_, n) => ({ row: n + 2, site: `WICP_000${n}`, session: `R000${n + 1}`, actions: 'Installation', date: `2026-0${n + 1}-10`, time: '09:00', result: 'ok' as const, label: '', message: '' }))
    many[0] = { ...many[0], result: 'problem', label: 'Actions not valid', message: 'Not valid.' }
    render(<FileRowResults rows={many} />)
    const group = screen.getByRole('group', { name: 'Revision' })
    // all of them, and the five latest — newest first; the older three are in the list
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('R0008'), expect.stringContaining('R0004')]))
    expect(within(group).queryByRole('button', { name: /R0003/ })).not.toBeInTheDocument()
    await userEvent.click(within(group).getByRole('button', { name: /R0008/ }))
    expect(screen.getByRole('button', { name: 'Rows read' })).toHaveTextContent('Rows read1')
    expect(within(screen.getByRole('table', { name: 'Rows of the file' })).getAllByRole('button', { name: /^View the contents of Row/ })).toHaveLength(1)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Older revisions' }), 'R0001')
    expect(screen.getByRole('button', { name: 'Rows read' })).toHaveTextContent('Rows read1')
    expect(screen.getByRole('button', { name: 'With problems' })).toHaveTextContent('With problems1')
  })
})
