//! Postgres TLS with working channel binding (Neon requires it). `tokio-postgres-rustls` 0.13
//! hashes the wrong part of the certificate, so Neon refuses the login; this computes the RFC 5929
//! `tls-server-end-point` hash correctly. Certificates are still fully verified.

use std::future::Future;
use std::io;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use rustls::pki_types::ServerName;
use sha2::{Digest, Sha256, Sha384, Sha512};
use tokio::io::{AsyncRead, AsyncWrite, ReadBuf};
use tokio_postgres::tls::{ChannelBinding, MakeTlsConnect, TlsConnect, TlsStream};
use tokio_rustls::TlsConnector;
use x509_cert::der::Decode;

#[derive(Clone)]
pub struct MakeTls(pub Arc<rustls::ClientConfig>);

impl<S: AsyncRead + AsyncWrite + Unpin + Send + 'static> MakeTlsConnect<S> for MakeTls {
    type Stream = Stream<S>;
    type TlsConnect = Connect;
    type Error = io::Error;

    fn make_tls_connect(&mut self, domain: &str) -> io::Result<Connect> {
        let name = ServerName::try_from(domain.to_string()).map_err(|e| io::Error::new(io::ErrorKind::InvalidInput, e))?;
        Ok(Connect { cfg: self.0.clone(), name })
    }
}

pub struct Connect {
    cfg: Arc<rustls::ClientConfig>,
    name: ServerName<'static>,
}

impl<S: AsyncRead + AsyncWrite + Unpin + Send + 'static> TlsConnect<S> for Connect {
    type Stream = Stream<S>;
    type Error = io::Error;
    type Future = Pin<Box<dyn Future<Output = io::Result<Stream<S>>> + Send>>;

    fn connect(self, s: S) -> Self::Future {
        Box::pin(async move { Ok(Stream(TlsConnector::from(self.cfg).connect(self.name, s).await?)) })
    }
}

pub struct Stream<S>(tokio_rustls::client::TlsStream<S>);

impl<S: AsyncRead + AsyncWrite + Unpin> TlsStream for Stream<S> {
    fn channel_binding(&self) -> ChannelBinding {
        let (_, conn) = self.0.get_ref();
        let Some(der) = conn.peer_certificates().and_then(|c| c.first()) else { return ChannelBinding::none() };
        let Ok(cert) = x509_cert::Certificate::from_der(der.as_ref()) else { return ChannelBinding::none() };
        // RFC 5929 §4.1: hash with the certificate's signature hash; MD5 and SHA-1 become SHA-256.
        let hash = match cert.signature_algorithm.oid.to_string().as_str() {
            "1.2.840.113549.1.1.12" | "1.2.840.10045.4.3.3" => Sha384::digest(der.as_ref()).to_vec(),
            "1.2.840.113549.1.1.13" | "1.2.840.10045.4.3.4" => Sha512::digest(der.as_ref()).to_vec(),
            _ => Sha256::digest(der.as_ref()).to_vec(),
        };
        ChannelBinding::tls_server_end_point(hash)
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin> AsyncRead for Stream<S> {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut ReadBuf<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_read(cx, buf)
    }
}

impl<S: AsyncRead + AsyncWrite + Unpin> AsyncWrite for Stream<S> {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.0).poll_write(cx, buf)
    }
    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_flush(cx)
    }
    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.0).poll_shutdown(cx)
    }
}
