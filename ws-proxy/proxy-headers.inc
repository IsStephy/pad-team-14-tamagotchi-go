proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
# Sockets stay open for a whole raid or session.
proxy_read_timeout 1h;
proxy_send_timeout 1h;
