export function formatLogsForExport(logs: ILogItem[]) {
  return logs
    .map((log) =>
      [log.time, log.type, log.payload]
        .filter((value): value is string => Boolean(value))
        .join(' '),
    )
    .join('\n')
}
