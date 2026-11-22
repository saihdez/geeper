# VPN de todo el equipo

<!-- borrador: 2026-11-18 · complemento de TRAMITES.md §0.3 -->

Objetivo: que **todo el PC** (Windows, el navegador, WSL, Geeper y el worker) salga a internet por un
solo país, el que elijas, y que no se escape nada por otra vía.

Para comprobarlo en cualquier momento:

```bash
pnpm tsx scripts/verificar-vpn.ts US   # el código ISO del país elegido
```

Revisa desde Windows y desde WSL la IP y el país de salida, la fuga por IPv6, el túnel, el DNS, el
servicio de ubicación de Windows y la zona y región. No cambia nada.

**Estado (20-11-2026):** en marcha. Servidor Oracle Always Free `geeper-vpn` en US East (Ashburn), IP
efímera `150.136.165.130` (gratis; se mantiene mientras exista la instancia), túnel `geeper` instalado como servicio en Windows. El verificador da ✓ en
salida (Windows y WSL), IPv6, túnel, DNS y ubicación. Geeper tiene `VPN: requerido · US ·
150.136.165.130`. Pendiente y opcional: zona horaria y región de Windows (§4).

## 1. Elegir el servidor

Hace falta un servidor WireGuard **en el país elegido y con IP fija**.

| Opción | Costo | Ventaja | Desventaja |
|---|---|---|---|
| **Oracle Cloud Always Free + WireGuard** (recomendada) | **US$0** | IP **dedicada y fija**, solo tuya. 10 TB de tráfico al mes | Pide tarjeta para verificar (no cobra). La región de inicio no se puede cambiar después. A veces no hay cupo |
| VPS de pago (Vultr, DigitalOcean, Hetzner…) | US$4–6/mes | Igual que Oracle, sin trámites de cupo | Cuesta |
| VPN gratis (Proton VPN Free) | US$0 | Sin servidor | IP **compartida** que cambia y no siempre se puede elegir el país. Las redes la marcan como VPN |

**Recomendación: Oracle Cloud Always Free.** Cumple el US$0 al mes de PRODUCTO.md y da una IP fija y
exclusiva, que levanta menos sospechas que una IP compartida. Además, todas tus cuentas ven siempre
la misma IP, que es lo que busca §0.3 de TRAMITES.md. El script de §3 sirve igual en un VPS de pago si
algún día hace falta cambiar.

> **Ojo con el resto de tus cuentas.** Con todo el equipo en otro país, también tu banco, tu Google
> personal y tus suscripciones te van a ver ahí. Algunos te pedirán verificar el inicio de sesión y
> otros (bancos, streaming) pueden bloquear el acceso. Si pasa, se apaga el túnel con un clic.

## 2. Instalar el túnel en Windows (todo el equipo)

WSL sale a internet por Windows, así que con el túnel en Windows queda cubierto todo, también Geeper.

1. Instala el cliente oficial: [wireguard.com/install](https://www.wireguard.com/install/) → Windows.
2. **Import tunnel(s) from file** → elige el `.conf` (el del VPS de §3 o el del proveedor). Ponle de
   nombre `geeper`.
3. **Edit** y revisa que el `.conf` tenga:
   ```ini
   [Interface]
   PrivateKey = (no la compartas)
   Address = 10.8.0.2/32, fd08::2/128
   DNS = 1.1.1.1, 2606:4700:4700::1111   # o el DNS del proveedor

   [Peer]
   PublicKey = …
   Endpoint = <ip-del-servidor>:51820
   AllowedIPs = 0.0.0.0/0, ::/0           # TODO el tráfico, IPv4 e IPv6
   PersistentKeepalive = 25
   ```
   - `AllowedIPs = 0.0.0.0/0, ::/0` hace que **todo** pase por el túnel. Si falta `::/0`, el tráfico
     IPv6 sale por tu conexión normal y revela tu país.
   - `DNS = …` evita la fuga de DNS: mientras el túnel está activo, Windows usa ese DNS.
4. Marca **Block untunneled traffic (kill-switch)**. Si el túnel se cae, el equipo se queda sin
   internet en vez de salir por Costa Rica.
5. **Activate.**
6. Para que arranque solo con Windows, en una terminal de **administrador**:
   ```powershell
   & "C:\Program Files\WireGuard\wireguard.exe" /installtunnelservice "C:\ruta\geeper.conf"
   ```
   Así queda como servicio y se levanta antes de iniciar sesión. Con esta opción, guarda el `.conf`
   en una carpeta que solo pueda leer tu usuario.
7. Corre `pnpm tsx scripts/verificar-vpn.ts <PAIS>`. Las líneas de salida, IPv6 y túnel deben quedar en ✓.
8. En Geeper → **Sistema → Red** pon `VPN: requerido` y el país. Así nada se publica si el túnel se cae.

## 3. Servidor propio (VPS) en el país elegido

1. Crea la cuenta en [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Como **región de
   inicio** elige una del país (para US: *US East (Ashburn)*, *US West (Phoenix)* o *US West (San
   Jose)*). No se puede cambiar después. Pide tarjeta solo para verificar, y no cobra mientras uses
   recursos «Always Free».
2. **Compute → Instances → Create instance**:
   - Image: **Canonical Ubuntu 24.04**.
   - Shape: **VM.Standard.E2.1.Micro** (Always Free), o **VM.Standard.A1.Flex** con 1 OCPU y 6 GB
     (también Always Free, más potente). Si sale «Out of capacity», prueba el otro shape u otro
     *availability domain*, o reintenta más tarde.
   - Networking: deja que cree la VCN y la subred pública, con **Assign a public IPv4 address**.
   - SSH keys: **Paste public key** → el contenido de `cat ~/.ssh/id_ed25519.pub` en WSL (si no
     existe, créala con `ssh-keygen -t ed25519`).
   - Anota la **IP pública** cuando quede *Running*.
3. Abre el puerto en la nube: en la instancia, **Subnet → Security Lists → Default Security List →
   Add Ingress Rules**: Source CIDR `0.0.0.0/0`, IP Protocol **UDP**, Destination Port **51820**.
4. Recomendado: **Upgrade a Pay As You Go** (Billing → Upgrade). Sigue sin cobrar nada si te quedas en
   lo Always Free, y evita que Oracle recupere la instancia por estar «ociosa» (un VPN casi no gasta
   CPU, así que podría parecerlo).
5. Desde WSL, en la carpeta de Geeper, corre:
   ```bash
   ssh ubuntu@IP_DEL_VPS 'sudo bash -s' < scripts/vpn/instalar-servidor.sh > ~/geeper.conf
   ```
   [`scripts/vpn/instalar-servidor.sh`](../scripts/vpn/instalar-servidor.sh) instala WireGuard, activa
   el reenvío y el NAT, abre el firewall propio de la imagen de Oracle (y `ufw` si está encendido),
   fija la MTU del túnel y detecta si el VPS tiene IPv6. Escribe el `.conf` del PC en `~/geeper.conf`.
   La clave privada del PC viaja solo por SSH y no queda en el servidor. Si el VPS ya tiene un `wg0`,
   no toca nada.
6. Pasa el `.conf` a Windows y bórralo de WSL:
   ```bash
   W=$(wslpath "$(cmd.exe /c 'echo %USERPROFILE%' 2>/dev/null | tr -d '\r')")
   mv ~/geeper.conf "$W/Documents/geeper.conf"
   ```
   Luego sigue con §2 desde el paso 2. Una vez importado en WireGuard, borra también ese archivo:
   WireGuard guarda su propia copia cifrada.
7. Si el script avisa que el VPS no tiene IPv6, no hace falta tocar nada más. El `.conf` igual lleva
   `::/0`, así que el kill-switch corta el IPv6 de tu conexión normal en vez de dejarlo escaparse. El
   verificador lo confirma.

## 4. Que Windows también «esté» en ese país

El VPN cambia la IP. Hay otras señales de ubicación que no dependen de la IP:

| Señal | Dónde se cambia | ¿Hace falta? |
|---|---|---|
| **Servicio de ubicación** (Wi-Fi, GPS): los navegadores y las apps lo usan para la geolocalización | Configuración → Privacidad y seguridad → **Ubicación → desactivar** | **Sí.** Ya está desactivado (19-11-2026); si se reactiva, revela la ubicación real aunque uses VPN |
| **Zona horaria** | Configuración → Hora e idioma → Fecha y hora → desactiva «automática» y elige la del país | Recomendado: una IP de un país con la hora de otro es incoherente |
| **País o región** | Configuración → Hora e idioma → Idioma y región → País o región | Recomendado. Hoy dice «Brasil» |
| **Formato regional e idioma** | Igual que la anterior → Formato regional | Opcional. Puedes dejar el español |
| **Idioma del navegador** | Configuración del navegador → Idiomas | Opcional |

Los horarios de Geeper se guardan en UTC, así que cambiar la zona horaria no rompe nada: solo cambia
cómo se muestran las horas.

**Lo que Geeper no hace** (está fuera de alcance, ver PUBLICAR.md §1): falsificar la huella del
navegador, usar una IP distinta por cuenta o usar proxies residenciales. El objetivo es que el equipo
esté en un país, de forma coherente, no hacerse pasar por muchos equipos.

## 5. Mantenimiento

- **Corre el verificador** después de cada actualización grande de Windows o de cambiar de red (por
  ejemplo, otro Wi-Fi).
- **Si el VPS cambia de IP**, actualiza `Endpoint` en el `.conf` y la IP esperada en Sistema → Red.
- **No cambies de país una vez creadas las cuentas.** Si hace falta, hazlo una sola vez y espera
  algunas verificaciones de inicio de sesión.
- Para **apagar el VPN** un rato, usa «Deactivate» en WireGuard. Con el kill-switch activo, al
  desactivarlo vuelve la conexión normal.
