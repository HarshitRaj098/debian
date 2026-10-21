#ifndef BOOT_MANAGER_H
#define BOOT_MANAGER_H

#include <stdint.h>

typedef struct {
    uint32_t last_boot_ok;
    uint32_t crash_count;
    uint32_t recovery_mode;
    uint32_t firmware_version;
} BootState;

int boot_manager_init(void);
void boot_manager_report_success(void);
void boot_manager_report_failure(void);
bool boot_manager_in_recovery(void);

#endif
