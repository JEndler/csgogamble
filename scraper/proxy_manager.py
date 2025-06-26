import requests
from http_request_randomizer.requests.proxy.requestProxy import RequestProxy
import os


class ProxyManager():
    def __init__(self, debug=True, timeout=15, validateProxies=True):
        self.debug = debug
        self.filepath = "data/proxies.csv"
        self.timeout = timeout
        if validateProxies: self._checkSavedProxies()
        self.proxy_list = self.loadProxiesFromFile()
        self.LAST_USED_PROXY_INDEX = None
        # self.proxy_list = self._getNewProxies()

    def _getNewProxies(self):
        prxy = RequestProxy()
        proxy_list = prxy.get_proxy_list()
        self._debug("Created Proxy-List with length: " + str(len(proxy_list)))
        working_proxies = []
        for proxy in proxy_list:
            if proxy_list.index(proxy) % 50 == 0:
                self._debug("---")
                self._debug("Checked " + str(proxy_list.index(proxy)) + " Proxies so far.")
                self._debug("Found " + str(len(working_proxies)) + " working ones.")
                self._debug("---")
            try:
                proxies = {'http': proxy.get_address()}
                # Dont use the same Proxy twice
                if proxy.get_address() in working_proxies: continue
                r = requests.get('http://api.myip.com', proxies=proxies, timeout=self.timeout)
                # Check if the myip.com request errors
                if '"country":' not in r.text:
                    self._debug("Proxy #" + str(proxy_list.index(proxy)) + " results in Error.")
                    continue
                if default_ip == r.text:
                    self._debug("Proxy #" + str(proxy_list.index(proxy)) + " is not Secure.")
                    continue
                self._debug(r.text)
                working_proxies.append(proxy.get_address())
            except Exception:
                self._debug("Proxy #" + str(proxy_list.index(proxy)) + " resulted in a timeout.")
                pass
        return working_proxies

    def loadProxiesFromFile(self):
        assert os.path.isfile(self.filepath), "Proxies.csv file not Found."
        with open(self.filepath, "r") as csvfile:
            return [s.replace("\n", "") for s in csvfile.readlines() if s != "\n"]

    def _checkSavedProxies(self):
        proxys = self.loadProxiesFromFile()
        working_proxies = []
        self._debug("Checking Proxies loaded from: " + self.filepath)
        self._debug(str(len(proxys)) + " Proxies loaded.")
        r = requests.get('http://api.myip.com')
        default_ip = r.text
        print("Current IP is: " + default_ip)
        for prxy in proxys:
            try:
                proxies = {'http': prxy}
                r = requests.get('http://api.myip.com', proxies=proxies, timeout=self.timeout)
                # Check if the myip.com request errors
                if '"country":' not in r.text:
                    self._debug("Proxy #" + str(proxys.index(prxy)) + " results in Error.")
                    continue
                if default_ip == r.text:
                    self._debug("Proxy #" + str(proxys.index(prxy)) + " is not Secure.")
                    continue
                self._debug(r.text)
                working_proxies.append(prxy)
            except Exception as e:
                self._debug("Proxy #" + str(proxys.index(prxy)) + " failed.")
                self._debug(e)
                pass
        self._writeProxiesToFile(working_proxies)
        return working_proxies

    def _writeProxiesToFile(self, proxy_list):
        with open(self.filepath, "w") as csvfile:
            csvfile.writelines(["%s\n" % s for s in proxy_list])

    def _saveMergedProxiesToFile(self, new_proxy_list):
        all_proxies = set(new_proxy_list + self.proxy_list)
        self._debug("Writing " + str(len(all_proxies)) + " new Proxies to File")
        with open("data/proxies.csv", "w") as csvfile:
            csvfile.writelines(["%s\n" % s for s in all_proxies])

    def updateProxyList(self):
        newProxies = self._getNewProxies()
        self.proxy_list = self._checkSavedProxies()
        self._saveMergedProxiesToFile(newProxies)
        self.proxy_list = self.loadProxiesFromFile()

    def _debug(self, s):
        if self.debug: print("proxyManager: " + str(s))

    def proxiedRequest(self, url, requesttype="GET"):
        # TODO Add automatic User-Agent switching
        proxy = self.getProxy()
        try:
            # Connect and Save the HTML Page
            # User Agent Mozilla to Circumvent Security Blocking
            req = requests.request(
                requesttype,
                url,
                proxies={
                    'http': proxy
                })
            page_html = req.text
        except Exception as e:
            # If its a HTTP-429 -> rotate to another Proxy
            if "HTTP Error 429" in str(e):
                return self.proxiedRequest(url, requesttype)
            # If its a Timeout Error -> delete current Proxy
            else:
                self._delProxy(proxy)
                return self.proxiedRequest(url, requesttype)
        return page_html

    def _delProxy(self, proxy):
        del self.proxy_list[self.proxy_list.index(proxy)]
        self._writeProxiesToFile(self.proxy_list)

    def getProxy(self):
        if self.LAST_USED_PROXY_INDEX is None:
            self.LAST_USED_PROXY_INDEX = 0
            return self.proxy_list[0]
        self.LAST_USED_PROXY_INDEX += 1
        if self.LAST_USED_PROXY_INDEX >= len(self.proxy_list):
            self.LAST_USED_PROXY_INDEX = 0
        return self.proxy_list[self.LAST_USED_PROXY_INDEX]


if __name__ == "__main__":
    r = requests.get('http://api.myip.com')
    default_ip = r.text
    print("Current IP is: " + default_ip)
    PM = ProxyManager()
    PM.updateProxyList()
