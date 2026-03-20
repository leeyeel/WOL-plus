#include <arpa/inet.h>
#include <errno.h>
#include <linux/if_packet.h>
#include <net/ethernet.h>
#include <net/if.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static void usage(FILE *stream, const char *prog) {
    fprintf(stream, "Usage: %s --interface <name> --frame-hex <hex>\n", prog);
}

static int hex_value(char c) {
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
        return c - 'A' + 10;
    }
    return -1;
}

static uint8_t *decode_hex(const char *hex, size_t *out_len) {
    size_t len = strlen(hex);
    if (len == 0 || (len % 2) != 0) {
        fprintf(stderr, "invalid frame hex length\n");
        return NULL;
    }

    uint8_t *buf = malloc(len / 2);
    if (!buf) {
        perror("malloc");
        return NULL;
    }

    for (size_t i = 0; i < len; i += 2) {
        int hi = hex_value(hex[i]);
        int lo = hex_value(hex[i + 1]);
        if (hi < 0 || lo < 0) {
            fprintf(stderr, "invalid frame hex\n");
            free(buf);
            return NULL;
        }
        buf[i / 2] = (uint8_t) ((hi << 4) | lo);
    }

    *out_len = len / 2;
    return buf;
}

int main(int argc, char **argv) {
    const char *interface = NULL;
    const char *frame_hex = NULL;

    for (int i = 1; i < argc; i++) {
        if ((strcmp(argv[i], "--interface") == 0 || strcmp(argv[i], "-i") == 0) && i + 1 < argc) {
            interface = argv[++i];
        } else if ((strcmp(argv[i], "--frame-hex") == 0 || strcmp(argv[i], "-f") == 0) && i + 1 < argc) {
            frame_hex = argv[++i];
        } else if (strcmp(argv[i], "--help") == 0 || strcmp(argv[i], "-h") == 0) {
            usage(stdout, argv[0]);
            return 0;
        } else {
            usage(stderr, argv[0]);
            return 2;
        }
    }

    if (!interface || !frame_hex) {
        usage(stderr, argv[0]);
        return 2;
    }

    unsigned int ifindex = if_nametoindex(interface);
    if (ifindex == 0) {
        perror("if_nametoindex");
        return 1;
    }

    size_t frame_len = 0;
    uint8_t *frame = decode_hex(frame_hex, &frame_len);
    if (!frame) {
        return 2;
    }

    if (frame_len < ETH_HLEN) {
        fprintf(stderr, "frame too short\n");
        free(frame);
        return 2;
    }

    int sock = socket(AF_PACKET, SOCK_RAW, htons(ETH_P_ALL));
    if (sock < 0) {
        perror("socket");
        free(frame);
        return 1;
    }

    struct sockaddr_ll addr;
    memset(&addr, 0, sizeof(addr));
    addr.sll_family = AF_PACKET;
    addr.sll_ifindex = (int) ifindex;
    addr.sll_halen = ETH_ALEN;
    memcpy(addr.sll_addr, frame, ETH_ALEN);

    ssize_t sent = sendto(sock, frame, frame_len, 0, (struct sockaddr *) &addr, sizeof(addr));
    if (sent < 0 || (size_t) sent != frame_len) {
        if (sent < 0) {
            perror("sendto");
        } else {
            fprintf(stderr, "partial send: %zd/%zu\n", sent, frame_len);
        }
        close(sock);
        free(frame);
        return 1;
    }

    close(sock);
    free(frame);
    return 0;
}
