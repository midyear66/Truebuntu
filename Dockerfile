FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
WORKDIR /app
RUN echo "deb http://deb.debian.org/debian bookworm contrib" >> /etc/apt/sources.list.d/contrib.list && \
    apt-get update && apt-get install -y --no-install-recommends \
    smartmontools rclone zfsutils-linux nfs-common samba-common-bin gdisk \
    procps systemd passwd && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=frontend-build /app/dist ./static/
ENV DBUS_SYSTEM_BUS_ADDRESS=unix:path=/var/run/dbus/system_bus_socket
EXPOSE 80
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "80"]
