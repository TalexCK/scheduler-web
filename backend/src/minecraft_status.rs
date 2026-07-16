use std::io::{self, ErrorKind};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    time::timeout,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(3);
const MAX_PACKET_LENGTH: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MinecraftStatus {
    pub online: bool,
    pub host: String,
    pub port: u16,
    pub latency_ms: Option<u64>,
    pub online_players: Option<u64>,
    pub max_players: Option<u64>,
    pub version: Option<String>,
    pub motd: Option<String>,
    pub checked_at: String,
}

impl MinecraftStatus {
    pub fn offline(address: &str) -> Self {
        let (host, port) = response_target(address);
        Self {
            online: false,
            host,
            port,
            latency_ms: None,
            online_players: None,
            max_players: None,
            version: None,
            motd: None,
            checked_at: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct StatusPayload {
    version: Option<VersionPayload>,
    players: Option<PlayersPayload>,
    description: Option<Value>,
}

#[derive(Debug, Deserialize)]
struct VersionPayload {
    name: String,
}

#[derive(Debug, Deserialize)]
struct PlayersPayload {
    online: u64,
    max: u64,
}

pub async fn query(address: &str) -> io::Result<MinecraftStatus> {
    match timeout(REQUEST_TIMEOUT, query_inner(address)).await {
        Ok(result) => result,
        Err(_) => Err(io::Error::new(
            ErrorKind::TimedOut,
            "Minecraft 状态探测超时",
        )),
    }
}

async fn query_inner(address: &str) -> io::Result<MinecraftStatus> {
    let (host, port) = split_address(address)?;
    let started_at = Instant::now();
    let mut stream = TcpStream::connect(address).await?;
    stream.set_nodelay(true)?;

    query_stream(&mut stream, address, host, port, started_at).await
}

async fn query_stream<S>(
    stream: &mut S,
    address: &str,
    host: &str,
    port: u16,
    started_at: Instant,
) -> io::Result<MinecraftStatus>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let mut handshake = Vec::new();
    write_varint(&mut handshake, 0);
    write_varint(&mut handshake, -1);
    write_string(&mut handshake, host)?;
    handshake.extend_from_slice(&port.to_be_bytes());
    write_varint(&mut handshake, 1);
    write_packet(stream, &handshake).await?;

    write_packet(stream, &[0]).await?;
    let payload = read_status_payload(stream).await?;

    let ping_value = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    let mut ping = vec![1];
    ping.extend_from_slice(&ping_value.to_be_bytes());
    write_packet(stream, &ping).await?;
    read_pong(stream, ping_value).await?;

    Ok(status_from_payload(address, payload, started_at.elapsed()))
}

fn split_address(address: &str) -> io::Result<(&str, u16)> {
    if let Some(rest) = address.strip_prefix('[') {
        let (host, port) = rest
            .split_once("]:")
            .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "无效的 Minecraft 地址"))?;
        return parse_host_port(host, port);
    }
    let (host, port) = address
        .rsplit_once(':')
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "无效的 Minecraft 地址"))?;
    parse_host_port(host, port)
}

fn parse_host_port<'a>(host: &'a str, port: &str) -> io::Result<(&'a str, u16)> {
    if host.is_empty() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "Minecraft 地址缺少主机名",
        ));
    }
    let port = port
        .parse()
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, "Minecraft 地址端口无效"))?;
    Ok((host, port))
}

fn response_target(address: &str) -> (String, u16) {
    split_address(address)
        .map(|(host, port)| (host.to_owned(), port))
        .unwrap_or_else(|_| (address.to_owned(), 0))
}

async fn read_status_payload<R: AsyncRead + Unpin>(stream: &mut R) -> io::Result<StatusPayload> {
    let packet_length = read_varint(stream).await?;
    let packet_length = checked_length(packet_length)?;
    let mut packet = vec![0; packet_length];
    stream.read_exact(&mut packet).await?;

    let mut cursor = packet.as_slice();
    if read_varint(&mut cursor).await? != 0 {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "Minecraft 状态响应包类型无效",
        ));
    }
    let json_length = checked_length(read_varint(&mut cursor).await?)?;
    if cursor.len() != json_length {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "Minecraft 状态响应长度无效",
        ));
    }
    serde_json::from_slice(cursor)
        .map_err(|_| io::Error::new(ErrorKind::InvalidData, "Minecraft 状态响应 JSON 无效"))
}

async fn read_pong<R: AsyncRead + Unpin>(stream: &mut R, expected: i64) -> io::Result<()> {
    let packet_length = checked_length(read_varint(stream).await?)?;
    let mut packet = vec![0; packet_length];
    stream.read_exact(&mut packet).await?;
    if packet.len() != 9 || packet[0] != 1 {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "Minecraft Pong 响应无效",
        ));
    }
    let echoed = i64::from_be_bytes(packet[1..].try_into().expect("已验证 Pong 长度"));
    if echoed != expected {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "Minecraft Pong 值不匹配",
        ));
    }
    Ok(())
}

fn checked_length(value: i32) -> io::Result<usize> {
    let value = usize::try_from(value)
        .map_err(|_| io::Error::new(ErrorKind::InvalidData, "数据包长度为负数"))?;
    if value > MAX_PACKET_LENGTH {
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "Minecraft 状态响应过大",
        ));
    }
    Ok(value)
}

fn status_from_payload(
    address: &str,
    payload: StatusPayload,
    latency: Duration,
) -> MinecraftStatus {
    let (host, port) = response_target(address);
    MinecraftStatus {
        online: true,
        host,
        port,
        latency_ms: Some(u64::try_from(latency.as_millis()).unwrap_or(u64::MAX)),
        online_players: payload.players.as_ref().map(|players| players.online),
        max_players: payload.players.map(|players| players.max),
        version: payload.version.map(|version| version.name),
        motd: payload.description.as_ref().and_then(motd_text),
        checked_at: chrono::Utc::now().to_rfc3339(),
    }
}

fn motd_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => non_empty(text.clone()),
        Value::Array(parts) => non_empty(
            parts
                .iter()
                .filter_map(motd_text)
                .collect::<Vec<_>>()
                .join(""),
        ),
        Value::Object(object) => {
            let mut text = object
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            if let Some(extra) = object.get("extra").and_then(Value::as_array) {
                for part in extra.iter().filter_map(motd_text) {
                    text.push_str(&part);
                }
            }
            non_empty(text)
        }
        _ => None,
    }
}

fn non_empty(value: String) -> Option<String> {
    (!value.trim().is_empty()).then_some(value)
}

async fn write_packet<W: AsyncWrite + Unpin>(stream: &mut W, payload: &[u8]) -> io::Result<()> {
    let length = i32::try_from(payload.len())
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, "请求数据包过大"))?;
    let mut packet = Vec::with_capacity(payload.len() + 5);
    write_varint(&mut packet, length);
    packet.extend_from_slice(payload);
    stream.write_all(&packet).await
}

fn write_string(buffer: &mut Vec<u8>, value: &str) -> io::Result<()> {
    let length = i32::try_from(value.len())
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, "Minecraft 主机名过长"))?;
    write_varint(buffer, length);
    buffer.extend_from_slice(value.as_bytes());
    Ok(())
}

fn write_varint(buffer: &mut Vec<u8>, value: i32) {
    let mut value = value as u32;
    loop {
        if value & !0x7f == 0 {
            buffer.push(value as u8);
            return;
        }
        buffer.push(((value & 0x7f) | 0x80) as u8);
        value >>= 7;
    }
}

async fn read_varint<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<i32> {
    let mut value = 0_u32;
    for position in 0..5 {
        let byte = reader.read_u8().await?;
        value |= u32::from(byte & 0x7f) << (position * 7);
        if byte & 0x80 == 0 {
            return Ok(value as i32);
        }
    }
    Err(io::Error::new(
        ErrorKind::InvalidData,
        "Minecraft VarInt 超过 5 字节",
    ))
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;

    #[tokio::test]
    async fn queries_a_mock_minecraft_status_server() {
        let (mut client, mut mock_server) = tokio::io::duplex(4096);
        let server = tokio::spawn(async move {
            read_test_packet(&mut mock_server).await;
            read_test_packet(&mut mock_server).await;

            let json = r#"{"version":{"name":"1.21.8"},"players":{"online":7,"max":80},"description":{"text":"测试网络"}}"#
                .as_bytes();
            let mut response = vec![0];
            write_varint(&mut response, i32::try_from(json.len()).unwrap());
            response.extend_from_slice(json);
            write_packet(&mut mock_server, &response).await.unwrap();

            let ping = read_test_packet(&mut mock_server).await;
            assert_eq!(ping.len(), 9);
            assert_eq!(ping[0], 1);
            write_packet(&mut mock_server, &ping).await.unwrap();
        });

        let status = query_stream(
            &mut client,
            "frp-hen.com:25568",
            "frp-hen.com",
            25568,
            Instant::now(),
        )
        .await
        .unwrap();
        server.await.unwrap();
        assert!(status.online);
        assert_eq!(status.host, "frp-hen.com");
        assert_eq!(status.port, 25568);
        assert_eq!(status.online_players, Some(7));
        assert_eq!(status.max_players, Some(80));
        assert_eq!(status.version.as_deref(), Some("1.21.8"));
        assert_eq!(status.motd.as_deref(), Some("测试网络"));
    }

    async fn read_test_packet<R: AsyncRead + Unpin>(stream: &mut R) -> Vec<u8> {
        let length = checked_length(read_varint(stream).await.unwrap()).unwrap();
        let mut packet = vec![0; length];
        stream.read_exact(&mut packet).await.unwrap();
        packet
    }

    #[tokio::test]
    async fn varint_round_trip_supports_protocol_minus_one() {
        for value in [0, 1, 127, 128, 25565, i32::MAX, -1] {
            let mut encoded = Vec::new();
            write_varint(&mut encoded, value);
            assert_eq!(read_varint(&mut Cursor::new(encoded)).await.unwrap(), value);
        }
    }

    #[test]
    fn parses_plain_and_component_motd() {
        let plain: StatusPayload = serde_json::from_str(
            r#"{"version":{"name":"1.21.8"},"players":{"online":3,"max":20},"description":"Hello"}"#,
        )
        .unwrap();
        let status = status_from_payload("frp-hen.com:25568", plain, Duration::from_millis(12));
        assert_eq!(status.version.as_deref(), Some("1.21.8"));
        assert_eq!(status.online_players, Some(3));
        assert_eq!(status.max_players, Some(20));
        assert_eq!(status.motd.as_deref(), Some("Hello"));

        let component: StatusPayload = serde_json::from_str(
            r#"{"description":{"text":"上海科技大学","extra":[{"text":"小游戏"},"网络"]}}"#,
        )
        .unwrap();
        let status = status_from_payload("frp-hen.com:25568", component, Duration::ZERO);
        assert_eq!(status.motd.as_deref(), Some("上海科技大学小游戏网络"));
    }

    #[test]
    fn parses_ipv4_hostname_and_ipv6_addresses() {
        assert_eq!(
            split_address("frp-hen.com:25568").unwrap(),
            ("frp-hen.com", 25568)
        );
        assert_eq!(split_address("[::1]:25565").unwrap(), ("::1", 25565));
        assert!(split_address("frp-hen.com").is_err());
    }
}
