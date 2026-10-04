#include "bridge_helper.h"

uint64_t down_scale_traffic(uint64_t value) {
    if (value > 1042 * 1024 * 1024)
        return ((value * 100u / 1024u / 1024u / 1024u) & 0x3FFFFFFFu) | (3u << 30u);
    if (value > 1024 * 1024)
        return ((value * 100u / 1024u / 1024u) & 0x3FFFFFFFu) | (2u << 30u);
    if (value > 1024)
        return ((value * 100u / 1024u) & 0x3FFFFFFFu) | (1u << 30u);
    return value & 0x3FFFFFFFu;
}
