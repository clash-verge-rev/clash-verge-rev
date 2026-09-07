#include <libproc.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>

int main(int argc, char **argv) {
  mach_timebase_info_data_t timebase;
  if (mach_timebase_info(&timebase) != KERN_SUCCESS) return 1;
  for (int i = 1; i < argc; i++) {
    int pid = atoi(argv[i]);
    struct rusage_info_v0 r;
    char path[PROC_PIDPATHINFO_MAXSIZE];
    if (pid <= 0 || proc_pid_rusage(pid, RUSAGE_INFO_V0, (rusage_info_t *)&r)) return 1;
    if (proc_pidpath(pid, path, sizeof(path)) <= 0) return 1;
    printf("%d %llu %.9f %llu %s\n", pid, r.ri_proc_start_abstime,
           ((double)r.ri_user_time + r.ri_system_time) * timebase.numer / timebase.denom / 1e9, r.ri_resident_size, path);
  }
  return 0;
}
