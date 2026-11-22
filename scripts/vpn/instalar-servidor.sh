#!/usr/bin/env bash
# Instala WireGuard en un VPS Ubuntu 22.04/24.04 nuevo y escribe en la salida estándar el .conf del PC
# (docs/VPN.md §3). Se corre desde WSL, sin copiarlo al servidor:
#
#   ssh ubuntu@IP_DEL_VPS 'sudo bash -s' < scripts/vpn/instalar-servidor.sh > ~/geeper.conf
#
# Pensado para Oracle Cloud Always Free (gratis), sirve en cualquier VPS Ubuntu. Las imágenes de
# Oracle traen reglas de iptables que rechazan todo menos SSH, incluido el reenvío: por eso el túnel
# abre el puerto y el reenvío por wg0 con PostUp, y las quita con PostDown.
#
# El .conf lleva la clave privada del PC: viaja solo por SSH y no queda en el servidor. Todo lo
# demás (avisos, progreso) sale por stderr. Si ya hay un wg0, no toca nada y termina con error.
set -euo pipefail
log() { echo "[vpn] $*" >&2; }

[ "$(id -u)" -eq 0 ] || { log "Hay que correrlo como root: ssh ubuntu@IP 'sudo bash -s' < …"; exit 1; }
[ ! -e /etc/wireguard/wg0.conf ] || { log "Ya existe /etc/wireguard/wg0.conf; no lo piso."; exit 1; }

log "Instalando WireGuard…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >&2
apt-get install -y -qq wireguard iptables curl >&2

IFACE=$(ip route show default | awk '{print $5; exit}')
IP4=$(curl -4 -fsS --max-time 10 https://api.ipify.org)
# IPv6 solo si el VPS tiene salida IPv6 pública; si no, el PC debe desactivar IPv6 (docs/VPN.md §3.4).
if curl -6 -fsS --max-time 10 https://api6.ipify.org >/dev/null 2>&1; then V6=1; else V6=0; fi
log "Interfaz $IFACE · IP pública $IP4 · IPv6: $([ $V6 = 1 ] && echo sí || echo no)"

cat > /etc/sysctl.d/99-wg.conf <<EOF
net.ipv4.ip_forward=1
$([ $V6 = 1 ] && echo net.ipv6.conf.all.forwarding=1)
EOF
sysctl -q --system >&2

cd /etc/wireguard
umask 077
wg genkey | tee servidor.key | wg pubkey > servidor.pub
PC_KEY=$(wg genkey)
PC_PUB=$(echo "$PC_KEY" | wg pubkey)

# Reglas de firewall locales (necesarias en Oracle, inofensivas en otros VPS). Se insertan arriba
# de los REJECT de la imagen. El TCPMSS ajusta el tamaño de los segmentos TCP al MTU del túnel: sin
# él, lo que sale de WSL (MTU 1500, sin aviso de fragmentación) se cuelga en saludos TLS grandes
# (p. ej. Node 24 con ML-KEM).
MSS="-p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu"
FW4_UP="iptables -t mangle -A FORWARD $MSS; iptables -I INPUT -p udp --dport 51820 -j ACCEPT; iptables -I FORWARD -i wg0 -j ACCEPT; iptables -I FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"
FW4_DOWN="iptables -t mangle -D FORWARD $MSS; iptables -D INPUT -p udp --dport 51820 -j ACCEPT; iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"
FW6_UP="ip6tables -I INPUT -p udp --dport 51820 -j ACCEPT; ip6tables -I FORWARD -i wg0 -j ACCEPT; ip6tables -I FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"
FW6_DOWN="ip6tables -D INPUT -p udp --dport 51820 -j ACCEPT; ip6tables -D FORWARD -i wg0 -j ACCEPT; ip6tables -D FORWARD -o wg0 -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT"

if [ $V6 = 1 ]; then
  SRV_ADDR="10.8.0.1/24, fd08::1/64"; PC_ALLOWED="10.8.0.2/32, fd08::2/128"; PC_ADDR="10.8.0.2/32, fd08::2/128"
  UP="$FW4_UP; $FW6_UP; iptables -t nat -A POSTROUTING -o $IFACE -j MASQUERADE; ip6tables -t nat -A POSTROUTING -o $IFACE -j MASQUERADE"
  DOWN="$FW4_DOWN; $FW6_DOWN; iptables -t nat -D POSTROUTING -o $IFACE -j MASQUERADE; ip6tables -t nat -D POSTROUTING -o $IFACE -j MASQUERADE"
  DNS="1.1.1.1, 2606:4700:4700::1111"
else
  SRV_ADDR="10.8.0.1/24"; PC_ALLOWED="10.8.0.2/32"; PC_ADDR="10.8.0.2/32"
  UP="$FW4_UP; iptables -t nat -A POSTROUTING -o $IFACE -j MASQUERADE"
  DOWN="$FW4_DOWN; iptables -t nat -D POSTROUTING -o $IFACE -j MASQUERADE"
  DNS="1.1.1.1"
fi

cat > wg0.conf <<EOF
[Interface]
Address = $SRV_ADDR
ListenPort = 51820
MTU = 1420
PrivateKey = $(cat servidor.key)
PostUp = $UP
PostDown = $DOWN

[Peer]
PublicKey = $PC_PUB
AllowedIPs = $PC_ALLOWED
EOF

systemctl enable --now wg-quick@wg0 >&2

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  log "ufw activo: abriendo 51820/udp y permitiendo el reenvío desde wg0."
  ufw allow 51820/udp >&2
  ufw allow OpenSSH >&2
  ufw route allow in on wg0 out on "$IFACE" >&2
fi

# .conf del PC. AllowedIPs siempre incluye ::/0: aunque el VPS no tenga IPv6, así el kill-switch de
# WireGuard en Windows también corta el IPv6 de la conexión normal en vez de dejarlo escaparse.
cat <<EOF
[Interface]
PrivateKey = $PC_KEY
Address = $PC_ADDR
DNS = $DNS

[Peer]
PublicKey = $(cat servidor.pub)
Endpoint = $IP4:51820
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
EOF

log "Listo. Servidor WireGuard en $IP4:51820. En Oracle, recuerda abrir UDP 51820 en la Security List (docs/VPN.md §3). Importa el .conf en WireGuard para Windows (docs/VPN.md §2)."
[ $V6 = 1 ] || log "El VPS no tiene IPv6: el túnel corta el IPv6 de tu conexión; el verificador lo confirma."
