from __future__ import annotations

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class StudioAuth:
    url: str
    anon_key: str
    access_token: str

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.access_token}",
            "apikey": self.anon_key,
        }


class StudioApiError(RuntimeError):
    def __init__(self, message: str, *, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def rest_get(auth: StudioAuth, table: str, params: str) -> list[dict]:
    res = httpx.get(
        f"{auth.url}/rest/v1/{table}?{params}",
        headers={**auth.headers, "Accept": "application/json"},
        timeout=60.0,
    )
    if res.status_code >= 400:
        raise StudioApiError(res.text or f"Failed to read {table}", status=res.status_code)
    data = res.json()
    if not isinstance(data, list):
        raise StudioApiError(f"Unexpected response from {table}")
    return data


def rest_patch(auth: StudioAuth, table: str, row_id: str, body: dict) -> None:
    res = httpx.patch(
        f"{auth.url}/rest/v1/{table}?id=eq.{row_id}",
        headers={
            **auth.headers,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json=body,
        timeout=60.0,
    )
    if res.status_code >= 400:
        raise StudioApiError(res.text or f"Failed to update {table}", status=res.status_code)


def rest_post(auth: StudioAuth, table: str, body: dict) -> dict:
    res = httpx.post(
        f"{auth.url}/rest/v1/{table}",
        headers={
            **auth.headers,
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        },
        json=body,
        timeout=60.0,
    )
    if res.status_code >= 400:
        raise StudioApiError(res.text or f"Failed to insert {table}", status=res.status_code)
    data = res.json()
    if isinstance(data, list) and data:
        return data[0]
    if isinstance(data, dict):
        return data
    raise StudioApiError(f"Unexpected insert response from {table}")


def download_object(auth: StudioAuth, bucket: str, path: str) -> bytes:
    res = httpx.get(
        f"{auth.url}/storage/v1/object/{bucket}/{path}",
        headers=auth.headers,
        timeout=300.0,
    )
    if res.status_code >= 400:
        raise StudioApiError(
            f"Could not download {bucket}/{path}: {res.text}",
            status=res.status_code,
        )
    return res.content


def upload_object(auth: StudioAuth, bucket: str, path: str, data: bytes, content_type: str) -> None:
    res = httpx.post(
        f"{auth.url}/storage/v1/object/{bucket}/{path}",
        headers={
            **auth.headers,
            "Content-Type": content_type,
            "x-upsert": "true",
        },
        content=data,
        timeout=300.0,
    )
    if res.status_code >= 400:
        raise StudioApiError(
            f"Could not upload {bucket}/{path}: {res.text}",
            status=res.status_code,
        )
